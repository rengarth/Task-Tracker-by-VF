package local.planner;
import java.time.*;
import java.util.*;
import static local.planner.Model.*;
public final class Rules {
    public static void require(boolean ok,String message) { if(!ok) throw new IllegalArgumentException(message); }
    public static Task task(State s, UUID id) { return s.tasks.stream().filter(t->t.id.equals(id)).findFirst().orElseThrow(()->new IllegalArgumentException("Задача не найдена")); }
    public static boolean descendant(State s,Task t,UUID ancestor) {
        Set<UUID> seen=new HashSet<>();
        while(t.parentId!=null) { require(seen.add(t.id),"Цикл в дереве задач"); if(t.parentId.equals(ancestor)) return true; t=task(s,t.parentId); }
        return false;
    }
    public static void validate(State s) {
        require(s.schemaVersion==1,"Неподдерживаемая версия резервной копии");
        unique(s.tasks.stream().map(t->t.id).toList()); unique(s.checklists.stream().map(t->t.id).toList());
        unique(s.items.stream().map(t->t.id).toList()); unique(s.comments.stream().map(t->t.id).toList());
        unique(s.entries.stream().map(t->t.id).toList()); unique(s.series.stream().map(t->t.id).toList());
        require(s.templates!=null&&s.audit!=null,"В резервной копии отсутствуют шаблоны или журнал");
        unique(s.templates.stream().map(t->t.id).toList()); unique(s.audit.stream().map(t->t.id).toList());
        for(TaskTemplate t:s.templates) {
            require(t.name!=null&&!t.name.isBlank()&&t.name.length()<=100,"Название шаблона: от 1 до 100 символов");
            require(t.title!=null&&!t.title.isBlank()&&t.title.length()<=500,"Укажите название задачи в шаблоне");
            require(t.assignee!=null&&!t.assignee.isBlank(),"Укажите исполнителя в шаблоне");
            require(Set.of("LOW","NORMAL","HIGH","CRITICAL").contains(t.priority),"Некорректный приоритет шаблона");
            require(t.checklistItems!=null&&t.checklistItems.size()<=100&&t.checklistItems.stream().allMatch(x->x!=null&&!x.isBlank()),"Некорректные пункты шаблона");
        }
        for(AuditEntry e:s.audit) require(e.taskId!=null&&e.createdAt!=null&&e.action!=null&&e.detail!=null,"Некорректная запись журнала");
        for(Task t:s.tasks) {
            require(t.title!=null&&!t.title.isBlank()&&t.title.length()<=500,"Введите название (до 500 символов)");
            require(t.assignee!=null&&!t.assignee.isBlank(),"Укажите исполнителя");
            require(t.priority!=null&&Set.of("LOW","NORMAL","HIGH","CRITICAL").contains(t.priority),"Некорректный приоритет");
            require(t.status!=null&&Set.of("PLANNED","IN_PROGRESS","DONE","CANCELED").contains(t.status),"Некорректный статус");
            require((t.startAt==null&&t.endAt==null)||(t.startAt!=null&&t.endAt!=null&&t.endAt.isAfter(t.startAt)),"Конец должен быть позже начала; заполните обе даты");
            Set<UUID> visited=new HashSet<>(); Task p=t; int depth=0;
            while(p.parentId!=null) { require(visited.add(p.id),"Цикл в дереве задач"); p=task(s,p.parentId); require(++depth<=2,"Допустимы только два уровня потомков"); require(t.deletedAt!=null||p.deletedAt==null,"Родитель находится в корзине"); }
            if(t.seriesId!=null) require(s.series.stream().anyMatch(r->r.id.equals(t.seriesId)),"Серия не найдена");
        }
        for(Checklist c:s.checklists) { task(s,c.taskId); require(c.title!=null&&!c.title.isBlank(),"Введите название чек-листа"); }
        for(Item i:s.items) { require(s.checklists.stream().anyMatch(c->c.id.equals(i.checklistId)),"Чек-лист не найден"); require(i.text!=null&&!i.text.isBlank(),"Введите текст пункта"); }
        for(Comment c:s.comments) { task(s,c.taskId); require(c.text!=null&&!c.text.isBlank(),"Комментарий пуст"); }
        for(Entry e:s.entries) {
            task(s,e.taskId); require(Set.of("MANUAL","TIMER").contains(e.source),"Некорректный источник времени");
            require(e.seconds>0,"Длительность должна быть положительной");
            require((e.startAt==null&&e.endAt==null&&e.workDate!=null)||(e.startAt!=null&&e.endAt!=null&&e.endAt.isAfter(e.startAt)),"Укажите корректный интервал либо дату работы");
            if(e.startAt!=null) require(e.seconds==Duration.between(e.startAt,e.endAt).getSeconds(),"Длительность не соответствует интервалу");
        }
        for(Series r:s.series) { task(s,r.templateId); require(Set.of("DAILY","WEEKLY","WEEKDAYS","MONTHLY").contains(r.frequency),"Некорректное повторение"); ZoneId.of(r.zone); require(r.count>=1&&r.count<=366,"Число повторов: от 1 до 366"); require(r.weekdays.stream().allMatch(d->d>=1&&d<=7),"Некорректные дни недели"); }
        require(s.timer!=null&&Set.of("STOPPED","RUNNING","PAUSED").contains(s.timer.state),"Некорректный таймер");
        if(!s.timer.state.equals("STOPPED")) { Task t=task(s,s.timer.taskId); require(t.deletedAt==null,"Таймер удалённой задачи"); }
        require(!s.timer.state.equals("RUNNING")||s.timer.startedAt!=null,"Нет начала таймера");
    }
    private static void unique(List<UUID> ids) { require(!ids.contains(null)&&new HashSet<>(ids).size()==ids.size(),"Повторяющиеся или пустые ID"); }
    public static List<Task> expand(State s) {
        List<Task> changed=new ArrayList<>();
        for(int pass=0;pass<3;pass++) for(Task c:s.tasks) if(c.deletedAt==null&&c.parentId!=null&&c.startAt!=null) {
            Task p=task(s,c.parentId); Instant a=p.startAt,b=p.endAt;
            if(p.startAt==null||c.startAt.isBefore(p.startAt)) p.startAt=c.startAt;
            if(p.endAt==null||c.endAt.isAfter(p.endAt)) p.endAt=c.endAt;
            if(!Objects.equals(a,p.startAt)||!Objects.equals(b,p.endAt)) { p.updatedAt=Instant.now(); if(!changed.contains(p)) changed.add(p); }
        }
        return changed;
    }
    public record Conflict(Task first,Task second) {}
    public static List<Conflict> conflicts(State s) {
        List<Task> roots=s.tasks.stream().filter(t->t.deletedAt==null&&t.parentId==null&&t.startAt!=null&&!t.status.equals("CANCELED")).toList();
        List<Conflict> out=new ArrayList<>();
        for(int a=0;a<roots.size();a++) for(int b=a+1;b<roots.size();b++) { Task x=roots.get(a),y=roots.get(b); if(x.startAt.isBefore(y.endAt)&&y.startAt.isBefore(x.endAt)) out.add(new Conflict(x,y)); }
        return out;
    }
    public static boolean overdue(Task t,Instant now) { return t.endAt!=null&&t.endAt.isBefore(now)&&!Set.of("DONE","CANCELED").contains(t.status); }
    public static Map<LocalDate,Double> split(Instant start,Instant end,ZoneId zone) {
        Map<LocalDate,Double> days=new TreeMap<>();
        while(start.isBefore(end)) { LocalDate date=start.atZone(zone).toLocalDate(); Instant next=date.plusDays(1).atStartOfDay(zone).toInstant(); Instant stop=next.isBefore(end)?next:end; days.merge(date,Duration.between(start,stop).toMillis()/3600000.0,Double::sum); start=stop; }
        return days;
    }
}
