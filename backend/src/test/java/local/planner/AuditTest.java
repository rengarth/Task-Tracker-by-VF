package local.planner;

import org.junit.jupiter.api.Test;
import java.time.Instant;
import java.util.*;
import static local.planner.Model.*;
import static org.junit.jupiter.api.Assertions.*;

class AuditTest {
    @Test void taskAndChecklistChangesAreRecordedWithoutSecondsInPresentationData() {
        State before=new State();
        Task task=new Task(); task.title="Монтаж"; before.tasks.add(task);
        Checklist list=new Checklist(); list.taskId=task.id; before.checklists.add(list);
        Item item=new Item(); item.checklistId=list.id; item.text="Экспорт"; before.items.add(item);
        State after=new State();
        Task changed=new Task(); changed.id=task.id; changed.title=task.title; changed.status="DONE";
        changed.startAt=Instant.parse("2026-10-19T07:00:00Z"); changed.endAt=Instant.parse("2026-10-19T08:00:00Z");
        after.tasks.add(changed); after.checklists.add(list);
        Item done=new Item(); done.id=item.id; done.checklistId=list.id; done.text=item.text; done.done=true; after.items.add(done);
        Audit.record(before,after);
        assertTrue(after.audit.stream().anyMatch(e->e.action.equals("Статус")&&e.detail.contains("Выполнена")));
        assertTrue(after.audit.stream().anyMatch(e->e.action.equals("Пункт выполнен")&&e.detail.equals("Экспорт")));
        assertTrue(after.audit.stream().anyMatch(e->e.action.equals("Начало")));
        assertTrue(after.audit.stream().allMatch(e->e.taskId.equals(task.id)&&e.createdAt!=null));
    }

    @Test void newTaskAndTemplateChecklistProducePersistentHistory() {
        State before=new State(),after=new State();
        Task task=new Task(); task.title="Рилс"; after.tasks.add(task);
        Checklist list=new Checklist(); list.taskId=task.id; after.checklists.add(list);
        Item item=new Item(); item.checklistId=list.id; item.text="Подготовить исходники"; after.items.add(item);
        Audit.record(before,after);
        assertEquals(3,after.audit.size());
        assertEquals(List.of("Задача создана","Чек-лист создан","Пункт чек-листа добавлен"),after.audit.stream().map(e->e.action).toList());
    }
}
