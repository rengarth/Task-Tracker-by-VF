package local.planner;

import java.io.*;
import java.time.*;
import java.util.*;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import org.junit.jupiter.api.Test;
import static local.planner.Model.*;
import static org.junit.jupiter.api.Assertions.*;

class AnalyticsExportTest {
    final LocalDate day=LocalDate.parse("2026-10-16");
    final Instant now=Instant.parse("2026-10-16T15:00:00Z");
    Task task(State s,String title,String a,String b) { Task t=new Task();t.title=title;t.startAt=a==null?null:Instant.parse(a);t.endAt=b==null?null:Instant.parse(b);s.tasks.add(t);return t; }
    Entry manual(State s,Task t,LocalDate d,long seconds) {Entry e=new Entry();e.taskId=t.id;e.workDate=d;e.seconds=seconds;s.entries.add(e);return e;}
    XSSFWorkbook book(State s) throws IOException {return new XSSFWorkbook(new ByteArrayInputStream(AnalyticsExport.create(s,day,day,"UTC",now)));}
    double value(Sheet s,int r,int c) {return s.getRow(r).getCell(c).getNumericCellValue();}
    @Test void hierarchyReconcilesAndCompletionIsNotHoursRatio() throws Exception {
        State s=new State();Task root=task(s,"Root","2026-10-16T09:00:00Z","2026-10-16T11:00:00Z"); root.status="DONE";
        Task child=task(s,"Child","2026-10-16T09:00:00Z","2026-10-16T10:00:00Z");child.parentId=root.id;
        manual(s,root,day,3600);manual(s,child,day,7200);
        try(var w=book(s)) {Sheet summary=w.getSheet("Сводка");assertEquals(2,value(summary,4,0));assertEquals(3,value(summary,4,1));assertEquals(1,value(summary,4,2));assertEquals(1.5,value(summary,4,3));assertEquals(1,value(summary,4,4));assertEquals(1,value(summary,4,6));
            Sheet tasks=w.getSheet("Задачи");double p=0,f=0;for(int r=1;r<=tasks.getLastRowNum();r++){p+=value(tasks,r,8);f+=value(tasks,r,9);}assertEquals(2,p);assertEquals(3,f);
            assertEquals(3,value(w.getSheet("По дням"),1,2));
        }
    }
    @Test void clipsIntervalsAndIncludesLiveTimerWithoutChangingState() throws Exception {
        State s=new State();Task t=task(s,"Across midnight","2026-10-15T22:00:00Z","2026-10-16T02:00:00Z");
        Entry e=manual(s,t,day,4*3600);e.startAt=t.startAt;e.endAt=t.endAt;e.workDate=null;
        s.timer.taskId=t.id;s.timer.state="RUNNING";s.timer.startedAt=now.minusSeconds(1800);
        manual(s,t,day.minusDays(1),3600);
        try(var w=book(s)) {assertEquals(2,value(w.getSheet("Сводка"),4,0));assertEquals(2.5,value(w.getSheet("Сводка"),4,1));assertEquals(2,w.getSheet("Учёт времени").getLastRowNum());}
        assertEquals(2,s.entries.size());assertEquals("RUNNING",s.timer.state);assertEquals(now.minusSeconds(1800),s.timer.startedAt);
    }
    @Test void canceledAndUnscheduledActualIncludedDeletedExcludedAndTextSafe() throws Exception {
        State s=new State();Task canceled=task(s,"=1+1","2026-10-16T09:00:00Z","2026-10-16T10:00:00Z");canceled.status="CANCELED";
        Task backlog=task(s,"Backlog",null,null),deleted=task(s,"Trash",null,null);deleted.deletedAt=now;
        manual(s,canceled,day,3600);manual(s,backlog,day,1800);manual(s,deleted,day,3600);
        try(var w=book(s)) {Sheet summary=w.getSheet("Сводка");assertEquals(0,value(summary,4,0));assertEquals(1.5,value(summary,4,1));assertEquals(0,value(summary,4,4));assertEquals("",summary.getRow(4).getCell(3).getStringCellValue());assertEquals("",summary.getRow(4).getCell(6).getStringCellValue());assertEquals(CellType.STRING,summary.getRow(15).getCell(0).getCellType());assertEquals("=1+1",summary.getRow(15).getCell(0).getStringCellValue());}
    }
    @Test void dstActualAndPlanUseRealElapsedHours() throws Exception {
        State s=new State();LocalDate d=LocalDate.parse("2026-10-25");ZoneId zone=ZoneId.of("Europe/Berlin");Task t=task(s,"DST",d.atStartOfDay(zone).toInstant().toString(),d.plusDays(1).atStartOfDay(zone).toInstant().toString());
        Entry e=manual(s,t,d,25*3600);e.startAt=t.startAt;e.endAt=t.endAt;e.workDate=null;
        try(var w=new XSSFWorkbook(new ByteArrayInputStream(AnalyticsExport.create(s,d,d,zone.getId(),now)))) {assertEquals(25,value(w.getSheet("Сводка"),4,0));assertEquals(25,value(w.getSheet("По дням"),1,2));}
    }
    @Test void emptyReportHasNoFormulaErrorsAndHasNumericDates() throws Exception {
        try(var w=book(new State())) {assertEquals(4,w.getNumberOfSheets());assertEquals(0,value(w.getSheet("Сводка"),4,0));assertEquals(CellType.NUMERIC,w.getSheet("По дням").getRow(1).getCell(0).getCellType());for(Sheet s:w)for(Row r:s)for(Cell c:r)if(c.getCellType()==CellType.FORMULA)assertNotEquals(CellType.ERROR,c.getCachedFormulaResultType());}
    }
    @Test void invalidAndExcessivePeriodsAreRejected() {
        assertThrows(IllegalArgumentException.class,()->AnalyticsExport.create(new State(),day,day.minusDays(1),"UTC",now));
        assertThrows(IllegalArgumentException.class,()->AnalyticsExport.create(new State(),day,day.plusDays(3661),"UTC",now));
        assertThrows(IllegalArgumentException.class,()->AnalyticsExport.create(new State(),day,day,"missing",now));
    }
}
