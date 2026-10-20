package local.planner;
import org.junit.jupiter.api.Test;
import java.time.*;
import java.util.*;
import static org.junit.jupiter.api.Assertions.*;
import static local.planner.Model.*;
class RulesTest {
    Task task(String start,String end) { Task t=new Task(); t.title="Задача"; t.startAt=start==null?null:Instant.parse(start); t.endAt=end==null?null:Instant.parse(end); return t; }
    @Test void adjacentIntervalsDoNotConflict(){State s=new State();s.tasks.add(task("2026-10-12T14:00:00Z","2026-10-12T15:00:00Z"));s.tasks.add(task("2026-10-12T15:00:00Z","2026-10-12T16:00:00Z"));assertTrue(Rules.conflicts(s).isEmpty());}
    @Test void overlapIsStrict(){State s=new State();s.tasks.add(task("2026-10-12T14:00:00Z","2026-10-12T17:30:00Z"));s.tasks.add(task("2026-10-12T15:00:00Z","2026-10-12T16:00:00Z"));assertEquals(1,Rules.conflicts(s).size());}
    @Test void ancestorsExpandTransitivelyAndNeverShrink(){State s=new State();Task a=task(null,null),b=task("2026-10-12T14:00:00Z","2026-10-12T16:00:00Z"),c=task("2026-10-12T15:00:00Z","2026-10-12T18:00:00Z");b.parentId=a.id;c.parentId=b.id;s.tasks.addAll(List.of(a,b,c));Rules.validate(s);Rules.expand(s);assertEquals(c.endAt,a.endAt);assertEquals(b.startAt,a.startAt);assertTrue(Rules.conflicts(s).isEmpty());c.endAt=Instant.parse("2026-10-12T15:30:00Z");Rules.expand(s);assertEquals(Instant.parse("2026-10-12T18:00:00Z"),a.endAt);s.tasks.remove(c);Rules.expand(s);assertEquals(Instant.parse("2026-10-12T18:00:00Z"),b.endAt);}
    @Test void cyclesAndDepthAreRejected(){State s=new State();Task a=task(null,null),b=task(null,null),c=task(null,null),d=task(null,null);b.parentId=a.id;c.parentId=b.id;d.parentId=c.id;s.tasks.addAll(List.of(a,b,c,d));assertThrows(IllegalArgumentException.class,()->Rules.validate(s));s.tasks.remove(d);a.parentId=c.id;assertThrows(IllegalArgumentException.class,()->Rules.validate(s));}
    @Test void invalidFieldsAreRejected(){State s=new State();Task t=task("2026-10-12T14:00:00Z",null);s.tasks.add(t);assertThrows(IllegalArgumentException.class,()->Rules.validate(s));t.startAt=null;t.title=" ";assertThrows(IllegalArgumentException.class,()->Rules.validate(s));t.title="ok";t.parentId=UUID.randomUUID();assertThrows(IllegalArgumentException.class,()->Rules.validate(s));}
    @Test void overdueUsesStrictBoundary(){Instant now=Instant.parse("2026-10-12T15:00:00Z");Task t=task("2026-10-12T14:00:00Z",now.toString());assertFalse(Rules.overdue(t,now));assertTrue(Rules.overdue(t,now.plusNanos(1)));t.status="DONE";assertFalse(Rules.overdue(t,now.plusSeconds(1)));assertFalse(Rules.overdue(task(null,null),now));}
    @Test void midnightIsSplitWithoutDuplication(){var days=Rules.split(Instant.parse("2026-10-12T20:00:00Z"),Instant.parse("2026-10-12T23:00:00Z"),ZoneId.of("Europe/Moscow"));assertEquals(1.0,days.get(LocalDate.parse("2026-10-12")));assertEquals(2.0,days.get(LocalDate.parse("2026-10-13")));}
    @Test void springDstDayIs23Hours(){ZoneId zone=ZoneId.of("Europe/Berlin");LocalDate day=LocalDate.parse("2026-03-29");var days=Rules.split(day.atStartOfDay(zone).toInstant(),day.plusDays(1).atStartOfDay(zone).toInstant(),zone);assertEquals(23.0,days.get(day));}
    @Test void autumnDstDayIs25Hours(){ZoneId zone=ZoneId.of("Europe/Berlin");LocalDate day=LocalDate.parse("2026-10-25");var days=Rules.split(day.atStartOfDay(zone).toInstant(),day.plusDays(1).atStartOfDay(zone).toInstant(),zone);assertEquals(25.0,days.get(day));}
}
