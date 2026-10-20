package local.planner;

import java.time.Instant;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.*;
import java.util.function.Function;
import static local.planner.Model.*;

/** Records the committed before/after difference, including changes made by rules. */
final class Audit {
    private final State before, after;
    private final Instant time = Instant.now();
    private int sequence;

    private Audit(State before, State after) { this.before=before; this.after=after; }

    static void record(State before, State after) { new Audit(before,after).collect(); }

    private void add(UUID taskId,String action,String detail) {
        AuditEntry entry=new AuditEntry();
        entry.taskId=taskId; entry.action=action; entry.detail=detail;
        entry.createdAt=time; entry.revision=after.revision+1; entry.sequence=sequence++;
        after.audit.add(entry);
    }

    private static <T> Map<UUID,T> byId(List<T> values,Function<T,UUID> id) {
        Map<UUID,T> result=new LinkedHashMap<>();
        for(T value:values) result.put(id.apply(value),value);
        return result;
    }

    private static String show(Object value) {
        if(value==null) return "не указано";
        if(value instanceof Instant time) return DateTimeFormatter.ofPattern("dd.MM.yyyy HH:mm 'UTC'").withZone(ZoneOffset.UTC).format(time);
        if(value instanceof String text) return text.isBlank()?"пусто":text;
        return value.toString();
    }

    private void field(UUID id,String label,Object oldValue,Object newValue) {
        if(!Objects.equals(oldValue,newValue)) add(id,label,show(oldValue)+" → "+show(newValue));
    }

    private void collect() {
        tasks(); checklists(); items(); comments(); entries(); series(); timer();
    }

    private void tasks() {
        Map<UUID,Task> old=byId(before.tasks,t->t.id);
        for(Task current:after.tasks) {
            Task previous=old.remove(current.id);
            if(previous==null) {
                add(current.id,"Задача создана",current.title);
                if(current.parentId!=null) add(current.parentId,"Добавлена подзадача",current.title);
                continue;
            }
            field(current.id,"Название",previous.title,current.title);
            field(current.id,"Описание",previous.description,current.description);
            field(current.id,"Исполнитель",previous.assignee,current.assignee);
            field(current.id,"Приоритет",priority(previous.priority),priority(current.priority));
            field(current.id,"Статус",status(previous.status),status(current.status));
            field(current.id,"Начало",previous.startAt,current.startAt);
            field(current.id,"Окончание",previous.endAt,current.endAt);
            field(current.id,"Родитель",title(previous.parentId),title(current.parentId));
            field(current.id,"Порядок подзадачи",previous.sortOrder,current.sortOrder);
            field(current.id,"Корзина",previous.deletedAt==null?"Нет":"Да",current.deletedAt==null?"Нет":"Да");
            field(current.id,"Серия",previous.seriesId==null?"Нет":"Да",current.seriesId==null?"Нет":"Да");
        }
    }

    private String title(UUID id) {
        if(id==null) return "Корневая задача";
        return after.tasks.stream().filter(t->t.id.equals(id)).findFirst()
            .or(()->before.tasks.stream().filter(t->t.id.equals(id)).findFirst())
            .map(t->t.title).orElse(id.toString());
    }

    private static String status(String value) { return switch(value) {
        case "IN_PROGRESS" -> "В работе"; case "DONE" -> "Выполнена";
        case "CANCELED" -> "Отменена"; default -> "Запланирована";
    }; }
    private static String priority(String value) { return switch(value) {
        case "LOW" -> "Низкий"; case "HIGH" -> "Высокий";
        case "CRITICAL" -> "Критический"; default -> "Обычный";
    }; }

    private UUID checklistTask(UUID id) {
        return after.checklists.stream().filter(c->c.id.equals(id)).findFirst()
            .or(()->before.checklists.stream().filter(c->c.id.equals(id)).findFirst())
            .map(c->c.taskId).orElse(null);
    }

    private void checklists() {
        Map<UUID,Checklist> old=byId(before.checklists,c->c.id);
        for(Checklist current:after.checklists) if(old.remove(current.id)==null)
            add(current.taskId,"Чек-лист создан",current.title);
        for(Checklist removed:old.values()) add(removed.taskId,"Чек-лист удалён",removed.title);
    }

    private void items() {
        Map<UUID,Item> old=byId(before.items,i->i.id);
        for(Item current:after.items) {
            Item previous=old.remove(current.id);
            UUID taskId=checklistTask(current.checklistId);
            if(taskId==null) continue;
            if(previous==null) add(taskId,"Пункт чек-листа добавлен",current.text);
            else {
                field(taskId,"Пункт чек-листа изменён",previous.text,current.text);
                if(previous.done!=current.done) add(taskId,current.done?"Пункт выполнен":"Отметка пункта снята",current.text);
                field(taskId,"Порядок пункта «"+current.text+"»",previous.sortOrder,current.sortOrder);
            }
        }
        for(Item removed:old.values()) {
            UUID taskId=checklistTask(removed.checklistId);
            if(taskId!=null) add(taskId,"Пункт чек-листа удалён",removed.text);
        }
    }

    private void comments() {
        Map<UUID,Comment> old=byId(before.comments,c->c.id);
        for(Comment current:after.comments) {
            Comment previous=old.remove(current.id);
            if(previous==null) add(current.taskId,"Комментарий добавлен",current.text);
            else field(current.taskId,"Комментарий изменён",previous.text,current.text);
        }
        for(Comment removed:old.values()) add(removed.taskId,"Комментарий удалён",removed.text);
    }

    private static String entry(Entry e) {
        return (e.source.equals("TIMER")?"Таймер":"Вручную")+" · "+Math.round(e.seconds/60.0)+" мин · "+
            (e.startAt!=null?show(e.startAt)+" — "+show(e.endAt):show(e.workDate));
    }
    private void entries() {
        Map<UUID,Entry> old=byId(before.entries,e->e.id);
        for(Entry current:after.entries) {
            Entry previous=old.remove(current.id);
            if(previous==null) add(current.taskId,"Фактическое время добавлено",entry(current));
            else field(current.taskId,"Фактическое время изменено",entry(previous),entry(current));
        }
        for(Entry removed:old.values()) add(removed.taskId,"Фактическое время удалено",entry(removed));
    }

    private void series() {
        Map<UUID,Series> old=byId(before.series,r->r.id);
        for(Series current:after.series) {
            Series previous=old.remove(current.id);
            if(previous==null) add(current.templateId,"Повторение создано",series(current));
            else field(current.templateId,"Повторение изменено",series(previous),series(current));
        }
        for(Series removed:old.values()) add(removed.templateId,"Повторение удалено",series(removed));
    }
    private static String series(Series r) {
        String frequency=switch(r.frequency) { case "WEEKLY" -> "Еженедельно"; case "WEEKDAYS" -> "По дням недели"; case "MONTHLY" -> "Ежемесячно"; default -> "Ежедневно"; };
        return frequency+" · "+r.count+" экз. · до "+show(r.until)+" · дни "+r.weekdays;
    }

    private static String timerState(String state) { return switch(state) {
        case "RUNNING" -> "Идёт"; case "PAUSED" -> "Пауза"; default -> "Остановлен";
    }; }

    private void timer() {
        UUID previous=before.timer.taskId, current=after.timer.taskId;
        String from=before.timer.state, to=after.timer.state;
        if(Objects.equals(previous,current)&&from.equals(to)) return;
        if(previous!=null) add(previous,"Таймер",timerState(from)+" → "+timerState(Objects.equals(previous,current)?to:"STOPPED"));
        if(current!=null&&!Objects.equals(previous,current)) add(current,"Таймер",timerState("STOPPED")+" → "+timerState(to));
    }
}
