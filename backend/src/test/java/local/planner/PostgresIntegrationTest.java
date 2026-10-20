package local.planner;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import static local.planner.Model.*;
import static org.junit.jupiter.api.Assertions.*;
@SpringBootTest(properties={"spring.datasource.url=jdbc:postgresql://${DB_HOST:127.0.0.1}:${DB_PORT:5433}/personal_planner_test"})
@EnabledIfEnvironmentVariable(named="PLANNER_INTEGRATION",matches="true")
class PostgresIntegrationTest {
    @Test void templateCreatesChecklistAndAuditSurvivesExportAndRestore(){
        TaskTemplate template=new TaskTemplate(); template.name="Рилс"; template.title="Монтаж рилса";
        template.checklistItems=List.of("Смонтировать","Экспортировать");
        call("templates","save",template,true);
        Task task=t(template.title,null,null);
        call("tasks","from-template",Map.of("task",task,"templateId",template.id),true);
        State saved=service.read();
        assertEquals(1,saved.templates.size());
        assertEquals(1,saved.checklists.size());
        assertEquals(2,saved.items.size());
        assertTrue(saved.audit.stream().anyMatch(e->e.taskId.equals(task.id)&&e.action.equals("Пункт чек-листа добавлен")));
        task.status="IN_PROGRESS"; save(task);
        State snapshot=service.read();
        assertTrue(snapshot.audit.stream().anyMatch(e->e.taskId.equals(task.id)&&e.action.equals("Статус")));
        call("backup","import",Map.of("state",new State(),"mode","REPLACE","confirmed",true),true);
        call("backup","import",Map.of("state",snapshot,"mode","REPLACE","confirmed",true),true);
        State restored=service.read();
        assertEquals(snapshot.audit.size(),restored.audit.size());
        assertEquals(2,restored.items.size());
        assertEquals(1,restored.templates.size());
    }
    @Test void legacyListsMergeWithoutLosingItemsAndSecondListIsRejected(){
        State legacy=new State();Task task=t("Legacy",null,null);legacy.tasks.add(task);
        Checklist a=new Checklist(),b=new Checklist();a.taskId=task.id;b.taskId=task.id;a.sortOrder=0;b.sortOrder=1;legacy.checklists.addAll(List.of(a,b));
        Item x=new Item(),y=new Item();x.checklistId=a.id;x.text="First";x.done=true;y.checklistId=b.id;y.text="Second";legacy.items.addAll(List.of(x,y));
        call("backup","import",Map.of("state",legacy,"mode","REPLACE","confirmed",true),true);
        State result=service.read();assertEquals(1,result.checklists.size());assertEquals("Чек-лист",result.checklists.getFirst().title);assertEquals(2,result.items.size());
        assertTrue(result.items.stream().filter(i->i.id.equals(x.id)).findFirst().orElseThrow().done);
        assertTrue(result.items.stream().allMatch(i->i.checklistId.equals(a.id)));assertEquals(1,result.items.stream().filter(i->i.id.equals(y.id)).findFirst().orElseThrow().sortOrder);
        assertThrows(IllegalArgumentException.class,()->call("checklists","save",b,true));
    }
    @Test void checklistReorderIsAtomicAndDeleteCanBeUndone(){
        Task task=t("Checklist",null,null);save(task);Checklist c=new Checklist();c.taskId=task.id;call("checklists","save",c,true);
        Item a=new Item(),b=new Item();a.checklistId=c.id;b.checklistId=c.id;a.text="A";b.text="B";b.done=true;call("checklist-items","save",a,true);call("checklist-items","save",b,true);
        call("checklist-items","reorder",Map.of("checklistId",c.id,"ids",List.of(b.id,a.id)),true);
        assertEquals(0,service.read().items.stream().filter(i->i.id.equals(b.id)).findFirst().orElseThrow().sortOrder);
        long revision=service.read().revision;assertThrows(IllegalArgumentException.class,()->call("checklist-items","reorder",Map.of("checklistId",c.id,"ids",List.of(a.id,a.id)),true));assertEquals(revision,service.read().revision);
        Item snapshot=service.read().items.stream().filter(i->i.id.equals(b.id)).findFirst().orElseThrow();call("checklist-items","delete",Map.of("id",b.id),true);call("checklist-items","save",snapshot,true);
        assertTrue(service.read().items.stream().filter(i->i.id.equals(b.id)).findFirst().orElseThrow().done);assertEquals(2,service.read().items.size());
    }
    @Autowired PlannerService service;
    @Autowired ObjectMapper json;
    @Autowired JdbcTemplate db;
    PlannerService.Result call(String resource,String action,Object data,boolean confirm){return service.mutate(resource,action,new PlannerService.Command(service.read().revision,confirm,false,json.valueToTree(data)));}
    Task t(String name,String start,String end){Task t=new Task();t.title=name;t.startAt=start==null?null:Instant.parse(start);t.endAt=end==null?null:Instant.parse(end);return t;}
    void save(Task t){call("tasks","save",Map.of("task",t),true);}
    @BeforeEach void reset(){assertEquals("personal_planner_test",db.queryForObject("SELECT current_database()",String.class));call("timers","stop",Map.of(),true);call("backup","import",Map.of("state",new State(),"mode","REPLACE","confirmed",true),true);}
    @Test void conflictPreviewRollsBackAndExplicitConfirmationSaves(){Task a=t("A","2026-10-12T14:00:00Z","2026-10-12T17:30:00Z"),b=t("B","2026-10-12T15:00:00Z","2026-10-12T16:00:00Z");save(a);long version=service.read().revision;var ex=assertThrows(PlannerService.Decision.class,()->call("tasks","save",Map.of("task",b),false));assertEquals(1,ex.result.conflicts().size());assertEquals(1,service.read().tasks.size());assertEquals(version,service.read().revision);save(b);assertEquals(2,service.read().tasks.size());}
    @Test void expansionConflictIsAtomic(){Task a=t("A","2026-10-12T14:00:00Z","2026-10-12T16:00:00Z"),b=t("B","2026-10-12T17:00:00Z","2026-10-12T19:00:00Z"),child=t("Child","2026-10-12T15:00:00Z","2026-10-12T18:00:00Z");save(a);save(b);child.parentId=a.id;var ex=assertThrows(PlannerService.Decision.class,()->call("tasks","save",Map.of("task",child),false));assertEquals(1,ex.result.expanded().size());assertEquals(1,ex.result.conflicts().size());assertEquals(a.endAt,Rules.task(service.read(),a.id).endAt);save(child);assertEquals(child.endAt,Rules.task(service.read(),a.id).endAt);call("tasks","delete",Map.of("id",child.id),true);assertEquals(child.endAt,Rules.task(service.read(),a.id).endAt);}
    @Test void staleConfirmationCannotOverwriteNewerState(){Task a=t("A",null,null);long revision=service.read().revision;save(a);assertThrows(PlannerService.Stale.class,()->service.mutate("tasks","save",new PlannerService.Command(revision,true,false,json.valueToTree(Map.of("task",a)))));}
    @Test void concurrentWritersHaveOnlyOneWinner() throws Exception {long revision=service.read().revision;try(var executor=Executors.newFixedThreadPool(2)){CountDownLatch gate=new CountDownLatch(1);List<Future<Boolean>> jobs=new ArrayList<>();for(int i=0;i<2;i++)jobs.add(executor.submit(()->{gate.await();try{service.mutate("tasks","save",new PlannerService.Command(revision,true,false,json.valueToTree(Map.of("task",t("Concurrent",null,null)))));return true;}catch(PlannerService.Stale e){return false;}}));gate.countDown();int success=0;for(var job:jobs)if(job.get())success++;assertEquals(1,success);assertEquals(1,service.read().tasks.size());}}
    @Test void timerIsPersistentAndSwitchRequiresConfirmation() throws Exception {Task a=t("A",null,null),b=t("B",null,null);save(a);save(b);call("timers","start",Map.of("id",a.id),false);Thread.sleep(1100);assertEquals(a.id,service.read().timer.taskId);assertThrows(PlannerService.Decision.class,()->call("timers","start",Map.of("id",b.id),false));assertEquals(a.id,service.read().timer.taskId);call("timers","start",Map.of("id",b.id),true);State s=service.read();assertEquals(b.id,s.timer.taskId);assertEquals(1,s.entries.size());assertTrue(s.entries.getFirst().seconds>=1);assertThrows(IllegalArgumentException.class,()->call("tasks","delete",Map.of("id",b.id),true));call("timers","pause",Map.of(),true);assertEquals("PAUSED",service.read().timer.state);}
    @Test void statsDoNotDoubleCountChildrenOrEntries(){Task a=t("A","2026-10-12T14:00:00Z","2026-10-12T16:00:00Z"),b=t("B","2026-10-12T14:00:00Z","2026-10-12T15:00:00Z");save(a);b.parentId=a.id;save(b);Entry e=new Entry();e.taskId=b.id;e.seconds=3600;e.workDate=LocalDate.parse("2026-10-12");call("time-entries","save",e,true);var stats=service.stats(service.read(),e.workDate,e.workDate,"UTC");assertEquals(2.0,stats.get("plannedHours"));assertEquals(1.0,stats.get("actualHours"));}
    @Test void finishingParentRequiresConfirmationAndDoesNotFinishChild(){Task a=t("A",null,null),b=t("B",null,null);save(a);b.parentId=a.id;save(b);a.status="DONE";assertThrows(PlannerService.Decision.class,()->call("tasks","save",Map.of("task",a),false));save(a);assertEquals("PLANNED",Rules.task(service.read(),b.id).status);}
    @Test void trashRestoreRetainsAllRelatedData(){Task a=t("A",null,null),b=t("B",null,null);save(a);b.parentId=a.id;save(b);Checklist c=new Checklist();c.taskId=b.id;call("checklists","save",c,true);Item i=new Item();i.checklistId=c.id;i.text="Item";call("checklist-items","save",i,true);call("tasks","delete",Map.of("id",a.id),true);assertTrue(service.read().tasks.stream().allMatch(x->x.deletedAt!=null));call("tasks","restore",Map.of("id",a.id),true);assertTrue(service.read().tasks.stream().allMatch(x->x.deletedAt==null));assertEquals(1,service.read().items.size());}
    @Test void recurrenceKeepsExceptionsAndWallClockAcrossDst(){Task a=t("A","2026-03-28T08:00:00Z","2026-03-28T09:00:00Z");save(a);Series r=new Series();r.templateId=a.id;r.zone="Europe/Berlin";r.count=3;call("recurrences","save",r,true);List<Task> tasks=service.read().tasks.stream().sorted(Comparator.comparing(x->x.startAt)).toList();assertEquals(Instant.parse("2026-03-29T07:00:00Z"),tasks.get(1).startAt);Task exception=tasks.get(1);exception.title="Exception";save(exception);Task first=tasks.getFirst();first.title="Changed";call("tasks","save",Map.of("task",first,"scope","FUTURE"),true);assertEquals("Exception",Rules.task(service.read(),exception.id).title);assertEquals("Changed",Rules.task(service.read(),tasks.get(2).id).title);}
    @Test void monthlyRecurrenceReturnsToOriginalDay(){Task a=t("Month","2026-01-31T08:00:00Z","2026-01-31T09:00:00Z");save(a);Series r=new Series();r.templateId=a.id;r.frequency="MONTHLY";r.zone="UTC";r.count=3;call("recurrences","save",r,true);var dates=service.read().tasks.stream().map(x->x.startAt).sorted().toList();assertEquals(Instant.parse("2026-02-28T08:00:00Z"),dates.get(1));assertEquals(Instant.parse("2026-03-31T08:00:00Z"),dates.get(2));}
    @Test void recurrenceRuleUpdateKeepsExceptionsAndRelatedData(){Task a=t("Series","2026-10-12T08:00:00Z","2026-10-12T09:00:00Z");save(a);Series r=new Series();r.templateId=a.id;r.count=4;call("recurrences","save",r,true);var tasks=service.read().tasks.stream().sorted(Comparator.comparing(x->x.startAt)).toList();Task special=tasks.get(1);special.title="Exception";save(special);Comment c=new Comment();c.taskId=tasks.get(3).id;c.text="Keep";call("comments","save",c,true);r.count=2;call("recurrences","save",r,true);State s=service.read();assertNull(Rules.task(s,special.id).deletedAt);assertNotNull(Rules.task(s,c.taskId).deletedAt);assertEquals("Keep",s.comments.getFirst().text);assertEquals(4,s.tasks.size());}
    @Test void malformedImportCannotEraseData(){save(t("Keep",null,null));assertThrows(IllegalArgumentException.class,()->call("backup","import",Map.of("state",Map.of(),"mode","REPLACE","confirmed",true),true));assertEquals("Keep",service.read().tasks.getFirst().title);}
    @Test void mergeCollisionRollsBack(){save(t("Keep",null,null));State s=service.read();assertThrows(IllegalArgumentException.class,()->call("backup","import",Map.of("state",s,"mode","MERGE","confirmed",true),true));assertEquals(1,service.read().tasks.size());}
    @Test void fullExportRestoresAllEntityKinds(){Task a=t("All","2026-10-12T08:00:00Z","2026-10-12T09:00:00Z");save(a);Series r=new Series();r.templateId=a.id;r.count=2;call("recurrences","save",r,true);Task b=t("Child",null,null);b.parentId=a.id;save(b);Checklist c=new Checklist();c.taskId=b.id;call("checklists","save",c,true);Item i=new Item();i.checklistId=c.id;i.text="Check";call("checklist-items","save",i,true);Comment comment=new Comment();comment.taskId=b.id;comment.text="Text";call("comments","save",comment,true);Entry e=new Entry();e.taskId=b.id;e.workDate=LocalDate.parse("2026-10-12");e.seconds=120;call("time-entries","save",e,true);call("timers","start",Map.of("id",a.id),true);call("timers","pause",Map.of(),true);State snapshot=service.read();call("timers","stop",Map.of(),true);call("backup","import",Map.of("state",new State(),"mode","REPLACE","confirmed",true),true);call("backup","import",Map.of("state",snapshot,"mode","REPLACE","confirmed",true),true);State restored=service.read();restored.revision=snapshot.revision;assertEquals(json.valueToTree(snapshot),json.valueToTree(restored));}
    @Test void replacementCanMoveExistingCommentToNewParent(){Task a=t("Old",null,null);save(a);Comment c=new Comment();c.taskId=a.id;c.text="Retained";call("comments","save",c,true);State replacement=new State();Task b=t("New",null,null);replacement.tasks.add(b);c.taskId=b.id;replacement.comments.add(c);call("backup","import",Map.of("state",replacement,"mode","REPLACE","confirmed",true),true);assertEquals(b.id,service.read().comments.getFirst().taskId);}
    @Test void exportImportRoundTripAndInvalidImportIsAtomic(){Task a=t("A",null,null);save(a);Comment c=new Comment();c.taskId=a.id;c.text="Hello";call("comments","save",c,true);State snapshot=service.read();call("backup","import",Map.of("state",new State(),"mode","REPLACE","confirmed",true),true);assertTrue(service.read().tasks.isEmpty());call("backup","import",Map.of("state",snapshot,"mode","REPLACE","confirmed",true),true);assertEquals(c.text,service.read().comments.getFirst().text);snapshot.tasks.getFirst().title="";assertThrows(IllegalArgumentException.class,()->call("backup","import",Map.of("state",snapshot,"mode","REPLACE","confirmed",true),true));assertEquals("A",service.read().tasks.getFirst().title);}
}
