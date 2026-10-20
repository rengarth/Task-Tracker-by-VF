package local.planner;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.*;
import java.util.*;
import java.util.function.Function;
import static local.planner.Model.*;
import static local.planner.Rules.*;
@Service
public class PlannerService {
    private final Store store;
    private final ObjectMapper json;
    public PlannerService(Store store,ObjectMapper json) { this.store=store; this.json=json; }
    public record Command(long revision,boolean confirm,boolean preview,JsonNode data) {}
    public record Result(State state,List<Conflict> conflicts,List<Task> expanded,List<String> warnings,boolean saved) {}
    public static class Decision extends RuntimeException {
        public final Result result;
        public Decision(Result result) { super("Требуется подтверждение"); this.result=result; }
    }
    @Transactional(readOnly=true, isolation=org.springframework.transaction.annotation.Isolation.REPEATABLE_READ)
    public State read() { return store.read(); }
    private <T> T value(JsonNode n,Class<T> type) { return store.decode(n.toString(),type); }
    private UUID id(JsonNode n) { return UUID.fromString(n.path("id").asText()); }
    @Transactional
    public Result mutate(String resource,String action,Command cmd) {
        store.lock(); State s=store.read();
        if(s.revision!=cmd.revision) throw new Stale();
        State before=store.copy(s,State.class); List<String> warnings=new ArrayList<>();
        JsonNode n=cmd.data; require(n!=null,"Нет данных операции");
        switch(resource+"/"+action) {
            case "tasks/save", "schedule/save" -> saveTask(s,value(n.path("task"),Task.class),n.path("scope").asText("ONE"),warnings);
            case "tasks/from-template" -> createFromTemplate(s,value(n.path("task"),Task.class),UUID.fromString(n.path("templateId").asText()),warnings);
            case "tasks/delete" -> {
                Task t=task(s,id(n)); Set<UUID> ids=new HashSet<>();
                for(Task x:s.tasks) if(x.id.equals(t.id)||descendant(s,x,t.id)||(n.path("scope").asText().equals("FUTURE")&&t.seriesId!=null&&t.seriesId.equals(x.seriesId)&&!x.exception&&x.occurrenceDate.compareTo(t.occurrenceDate)>=0)) ids.add(x.id);
                for(Task x:s.tasks) for(UUID root:List.copyOf(ids)) if(descendant(s,x,root)) ids.add(x.id);
                require(s.timer.taskId==null||!ids.contains(s.timer.taskId)||s.timer.state.equals("STOPPED"),"Сначала остановите таймер этой задачи или потомка");
                Instant deleted=Instant.now(); for(Task x:s.tasks) if(ids.contains(x.id)) { x.deletedAt=deleted; x.exception=true; }
            }
            case "tasks/restore" -> { Task t=task(s,id(n)); Instant batch=t.deletedAt; for(Task x:s.tasks) if((x.id.equals(t.id)||descendant(s,x,t.id))&&Objects.equals(x.deletedAt,batch)) x.deletedAt=null; }
            case "tasks/clone" -> cloneTask(s,task(s,id(n)));
            case "checklists/save" -> { Checklist x=value(n,Checklist.class); require(s.checklists.stream().noneMatch(c->c.taskId.equals(x.taskId)&&!c.id.equals(x.id)),"У задачи уже есть чек-лист"); x.title="Чек-лист"; s.checklists.removeIf(c->c.id.equals(x.id)); s.checklists.add(x); }
            case "checklists/delete" -> { UUID id=id(n); s.items.removeIf(i->i.checklistId.equals(id)); s.checklists.removeIf(c->c.id.equals(id)); }
            case "checklist-items/save" -> { Item x=value(n,Item.class); s.items.removeIf(c->c.id.equals(x.id)); s.items.add(x); }
            case "checklist-items/delete" -> s.items.removeIf(c->c.id.equals(id(n)));
            case "checklist-items/reorder" -> { require(n.path("ids").isArray(),"Укажите порядок пунктов"); List<UUID> ids=new ArrayList<>();n.path("ids").forEach(x->ids.add(UUID.fromString(x.asText())));Checklists.reorder(s,UUID.fromString(n.path("checklistId").asText()),ids); }
            case "comments/save" -> { Comment x=value(n,Comment.class); s.comments.stream().filter(c->c.id.equals(x.id)).findFirst().ifPresent(c->x.createdAt=c.createdAt); x.updatedAt=Instant.now(); s.comments.removeIf(c->c.id.equals(x.id)); s.comments.add(x); }
            case "comments/delete" -> s.comments.removeIf(c->c.id.equals(id(n)));
            case "time-entries/save" -> { Entry x=value(n,Entry.class); if(x.startAt!=null&&x.endAt!=null) x.seconds=Duration.between(x.startAt,x.endAt).getSeconds(); s.entries.removeIf(c->c.id.equals(x.id)); s.entries.add(x); }
            case "time-entries/delete" -> s.entries.removeIf(c->c.id.equals(id(n)));
            case "timers/start", "timers/resume" -> {
                UUID target=id(n); require(task(s,target).deletedAt==null,"Задача в корзине");
                if(s.timer.state.equals("RUNNING")&&!target.equals(s.timer.taskId)) warnings.add("Текущий таймер будет приостановлен; его время сохранится отдельной записью.");
                if(!s.timer.state.equals("RUNNING")||!target.equals(s.timer.taskId)) { flushTimer(s); s.timer.taskId=target; s.timer.startedAt=Instant.now(); s.timer.state="RUNNING"; }
            }
            case "timers/pause" -> { flushTimer(s); s.timer.state=s.timer.taskId==null?"STOPPED":"PAUSED"; }
            case "timers/stop" -> { flushTimer(s); s.timer=new Model.Timer(); }
            case "recurrences/save" -> createSeries(s,value(n,Series.class));
            case "recurrences/delete" -> { UUID id=id(n); s.series.removeIf(r->r.id.equals(id)); for(Task t:s.tasks) if(id.equals(t.seriesId)) t.seriesId=null; }
            case "templates/save" -> { TaskTemplate t=value(n,TaskTemplate.class); s.templates.removeIf(x->x.id.equals(t.id)); s.templates.add(t); }
            case "templates/delete" -> s.templates.removeIf(t->t.id.equals(id(n)));
            case "backup/import" -> {
                require(n.path("confirmed").asBoolean(),"Подтвердите режим импорта");
                JsonNode imported=n.path("state");
                require(imported.isObject()&&imported.has("schemaVersion")&&imported.has("timer"),"Файл не является резервной копией планировщика");
                for(String field:List.of("tasks","checklists","items","comments","entries","series")) require(imported.path(field).isArray(),"В резервной копии отсутствует массив: "+field);
                State incoming=value(n.path("state"),State.class); validate(incoming); expand(incoming);
                String mode=n.path("mode").asText(); require(Set.of("MERGE","REPLACE").contains(mode),"Выберите режим импорта");
                require(s.timer.state.equals("STOPPED"),"Перед импортом остановите текущий таймер");
                if(mode.equals("REPLACE")) { incoming.revision=s.revision; s=incoming; }
                else { merge(s.tasks,incoming.tasks,x->x.id); merge(s.checklists,incoming.checklists,x->x.id); merge(s.items,incoming.items,x->x.id); merge(s.comments,incoming.comments,x->x.id); merge(s.entries,incoming.entries,x->x.id); merge(s.series,incoming.series,x->x.id); merge(s.templates,incoming.templates,x->x.id); merge(s.audit,incoming.audit,x->x.id); s.timer=incoming.timer; }
            }
            default -> throw new IllegalArgumentException("Неизвестная операция");
        }
        Checklists.normalize(s);
        validate(s); List<Task> expanded=expand(s); validate(s);
        Set<UUID> changed=new HashSet<>();
        for(Task t:s.tasks) { Task old=before.tasks.stream().filter(x->x.id.equals(t.id)).findFirst().orElse(null); if(old==null||!Objects.equals(t.startAt,old.startAt)||!Objects.equals(t.endAt,old.endAt)||!Objects.equals(t.parentId,old.parentId)||!Objects.equals(t.deletedAt,old.deletedAt)||!t.status.equals(old.status)) changed.add(t.id); }
        List<Conflict> conflicts=conflicts(s).stream().filter(c->changed.contains(c.first().id)||changed.contains(c.second().id)).toList();
        Result result=new Result(s,conflicts,expanded,warnings,false);
        if(cmd.preview) return result;
        if(!cmd.confirm&&(!conflicts.isEmpty()||!warnings.isEmpty()||!expanded.isEmpty())) throw new Decision(result);
        if(!resource.equals("backup")&&!resource.equals("templates")) Audit.record(before,s);
        s.revision++; store.save(s); return new Result(s,conflicts,expanded,warnings,true);
    }
    public static class Stale extends RuntimeException { public Stale(){super("Данные изменены в другой вкладке. Обновите данные и повторите действие.");} }
    private <T> void merge(List<T> current,List<T> incoming,Function<T,UUID> id) { Set<UUID> ids=new HashSet<>(); for(T t:current) ids.add(id.apply(t)); for(T t:incoming) { require(ids.add(id.apply(t)),"При слиянии обнаружен одинаковый ID. Выберите замену или другую копию."); current.add(t); } }
    private void saveTask(State s,Task t,String scope,List<String> warnings) {
        Task old=s.tasks.stream().filter(x->x.id.equals(t.id)).findFirst().orElse(null);
        if(old!=null) { t.createdAt=old.createdAt; t.deletedAt=old.deletedAt; t.seriesId=old.seriesId; t.occurrenceDate=old.occurrenceDate; t.exception=old.seriesId!=null; }
        t.updatedAt=Instant.now(); t.completedAt=t.status.equals("DONE")?(old!=null&&old.completedAt!=null?old.completedAt:Instant.now()):null;
        if(t.status.equals("DONE")&&(old==null||!old.status.equals("DONE"))&&s.tasks.stream().anyMatch(x->x.deletedAt==null&&descendant(s,x,t.id)&&!Set.of("DONE","CANCELED").contains(x.status))) warnings.add("У задачи есть незавершённые потомки. Их статусы останутся прежними.");
        if(old!=null&&old.seriesId!=null&&scope.equals("FUTURE")) {
            require(old.startAt!=null&&t.startAt!=null,"Для изменения будущих экземпляров укажите время");
            Series r=s.series.stream().filter(x->x.id.equals(old.seriesId)).findFirst().orElseThrow(); ZoneId zone=ZoneId.of(r.zone);
            long dayShift=java.time.temporal.ChronoUnit.DAYS.between(old.startAt.atZone(zone).toLocalDate(),t.startAt.atZone(zone).toLocalDate());
            LocalTime time=t.startAt.atZone(zone).toLocalTime(); Duration duration=Duration.between(t.startAt,t.endAt);
            for(Task x:s.tasks) if(!x.id.equals(old.id)&&old.seriesId.equals(x.seriesId)&&!x.exception&&x.deletedAt==null&&x.occurrenceDate.compareTo(old.occurrenceDate)>=0) {
                x.title=t.title; x.description=t.description; x.assignee=t.assignee; x.priority=t.priority; x.status=t.status; x.completedAt=t.completedAt;
                x.startAt=x.startAt.atZone(zone).toLocalDate().plusDays(dayShift).atTime(time).atZone(zone).toInstant(); x.endAt=x.startAt.plus(duration); x.updatedAt=Instant.now();
            }
            t.exception=false;
        }
        s.tasks.removeIf(x->x.id.equals(t.id)); s.tasks.add(t);
    }
    private void createFromTemplate(State s,Task task,UUID templateId,List<String> warnings) {
        require(s.tasks.stream().noneMatch(t->t.id.equals(task.id)),"Шаблон можно применить только при создании задачи");
        TaskTemplate template=s.templates.stream().filter(t->t.id.equals(templateId)).findFirst()
            .orElseThrow(()->new IllegalArgumentException("Шаблон не найден"));
        saveTask(s,task,"ONE",warnings);
        if(!template.checklistItems.isEmpty()) {
            Checklist list=new Checklist(); list.taskId=task.id; s.checklists.add(list);
            for(int index=0;index<template.checklistItems.size();index++) {
                Item item=new Item(); item.checklistId=list.id; item.text=template.checklistItems.get(index);
                item.sortOrder=index; s.items.add(item);
            }
        }
    }
    private void cloneTask(State s,Task old) {
        Task t=store.copy(old,Task.class); t.id=UUID.randomUUID(); t.title+=" (копия)"; t.seriesId=null; t.exception=false; t.occurrenceDate=null; t.status="PLANNED"; t.completedAt=null; t.createdAt=t.updatedAt=Instant.now(); t.deletedAt=null; s.tasks.add(t);
        for(Checklist c:List.copyOf(s.checklists)) if(c.taskId.equals(old.id)) { Checklist clone=store.copy(c,Checklist.class); clone.id=UUID.randomUUID(); clone.taskId=t.id; s.checklists.add(clone); for(Item item:List.copyOf(s.items)) if(item.checklistId.equals(c.id)) { Item i=store.copy(item,Item.class); i.id=UUID.randomUUID(); i.checklistId=clone.id; i.done=false; s.items.add(i); } }
    }
    private void flushTimer(State s) {
        if(s.timer.state.equals("RUNNING")) { Instant end=Instant.now(); long seconds=Duration.between(s.timer.startedAt,end).getSeconds(); if(seconds>0) { Entry e=new Entry(); e.taskId=s.timer.taskId; e.source="TIMER"; e.startAt=s.timer.startedAt; e.endAt=e.startAt.plusSeconds(seconds); e.seconds=seconds; s.entries.add(e); } s.timer.startedAt=null; }
    }
    private void createSeries(State s,Series r) {
        Series existing=s.series.stream().filter(x->x.id.equals(r.id)).findFirst().orElse(null);
        require(existing==null||existing.templateId.equals(r.templateId),"Нельзя менять исходную задачу серии");
        Task base=task(s,r.templateId); require(base.deletedAt==null&&base.startAt!=null&&base.parentId==null&&(base.seriesId==null||base.seriesId.equals(r.id)),"Для повторения нужна корневая задача с датой вне другой серии");
        require(r.count>=1&&r.count<=366,"От 1 до 366 экземпляров"); require(!r.frequency.equals("WEEKDAYS")||!r.weekdays.isEmpty(),"Выберите дни недели");
        ZoneId zone=ZoneId.of(r.zone); ZonedDateTime first=base.startAt.atZone(zone); Duration length=Duration.between(base.startAt,base.endAt);
        require(r.until==null||!r.until.isBefore(first.toLocalDate()),"Дата окончания серии раньше первого экземпляра");
        base.seriesId=r.id; base.occurrenceDate=first.toLocalDate(); s.series.removeIf(x->x.id.equals(r.id)); s.series.add(r);
        Set<LocalDate> dates=new HashSet<>(); dates.add(base.occurrenceDate);
        int generated=1;
        for(int step=1;generated<r.count&&step<=3660;step++) {
            ZonedDateTime next=switch(r.frequency) {case "MONTHLY"->first.plusMonths(step); case "WEEKLY"->first.plusWeeks(step); default->first.plusDays(step);};
            if(r.until!=null&&next.toLocalDate().isAfter(r.until)) break;
            if(r.frequency.equals("WEEKDAYS")&&!r.weekdays.contains(next.getDayOfWeek().getValue())) continue;
            LocalDate date=next.toLocalDate(); dates.add(date);
            Task t=s.tasks.stream().filter(x->r.id.equals(x.seriesId)&&date.equals(x.occurrenceDate)).findFirst().orElse(null);
            if(t==null) { t=store.copy(base,Task.class); t.id=UUID.randomUUID(); t.status="PLANNED"; t.completedAt=null; t.exception=false; t.createdAt=t.updatedAt=Instant.now(); s.tasks.add(t); }
            if(!t.exception) { t.startAt=next.toInstant(); t.endAt=t.startAt.plus(length); t.occurrenceDate=date; t.deletedAt=null; t.updatedAt=Instant.now(); }
            generated++;
        }
        // Removed generated dates go to trash, retaining comments, descendants and tracked work.
        for(Task t:s.tasks) if(r.id.equals(t.seriesId)&&!t.exception&&!dates.contains(t.occurrenceDate)&&t.deletedAt==null) {
            List<Task> branch=new ArrayList<>(); branch.add(t); for(Task child:s.tasks) if(descendant(s,child,t.id)) branch.add(child);
            require(s.timer.state.equals("STOPPED")||branch.stream().noneMatch(x->x.id.equals(s.timer.taskId)),"Сначала остановите таймер удаляемого экземпляра");
            Instant deletion=Instant.now(); for(Task child:branch) child.deletedAt=deletion;
        }
    }
    public Map<String,Object> stats(State s,LocalDate from,LocalDate to,String timezone) {
        require(!to.isBefore(from),"Конец периода раньше начала"); ZoneId zone=ZoneId.of(timezone);
        Map<LocalDate,Double> plan=new TreeMap<>(),actual=new TreeMap<>();
        for(Task t:s.tasks) if(t.deletedAt==null&&t.parentId==null&&t.startAt!=null&&!t.status.equals("CANCELED")) split(t.startAt,t.endAt,zone).forEach((d,h)->plan.merge(d,h,Double::sum));
        for(Entry e:s.entries) if(task(s,e.taskId).deletedAt==null) { if(e.startAt!=null) split(e.startAt,e.endAt,zone).forEach((d,h)->actual.merge(d,h,Double::sum)); else actual.merge(e.workDate,e.seconds/3600.0,Double::sum); }
        if(s.timer.state.equals("RUNNING")) split(s.timer.startedAt,Instant.now(),zone).forEach((d,h)->actual.merge(d,h,Double::sum));
        plan.keySet().removeIf(d->d.isBefore(from)||d.isAfter(to)); actual.keySet().removeIf(d->d.isBefore(from)||d.isAfter(to));
        Instant a=from.atStartOfDay(zone).toInstant(),b=to.plusDays(1).atStartOfDay(zone).toInstant();
        List<Task> tasks=s.tasks.stream().filter(t->t.deletedAt==null&&t.startAt!=null&&t.startAt.isBefore(b)&&a.isBefore(t.endAt)).toList();
        double p=plan.values().stream().mapToDouble(x->x).sum(),f=actual.values().stream().mapToDouble(x->x).sum();
        return Map.of("plannedHours",p,"actualHours",f,"deviation",f-p,"count",tasks.size(),"done",tasks.stream().filter(t->t.status.equals("DONE")).count(),"planByDay",plan,"actualByDay",actual);
    }
}
