package local.planner;

import java.io.*;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.util.*;
import org.apache.poi.ss.usermodel.*;
import org.apache.poi.ss.util.CellRangeAddress;
import org.apache.poi.xssf.usermodel.XSSFWorkbook;
import static local.planner.Model.*;

/** A read-only report from one consistent state and one captured clock instant. */
final class AnalyticsExport {
    record Slice(UUID entryId, UUID taskId, String source, LocalDate date, Instant start, Instant end, double hours) {}
    private final State state;
    private final LocalDate from, to;
    private final ZoneId zone;
    private final Instant now, begin, end;
    private final Map<UUID,Task> tasks = new LinkedHashMap<>();
    private final Map<UUID,Double> plan = new HashMap<>(), own = new HashMap<>(), total = new HashMap<>();
    private final Map<LocalDate,Double> planDays = new TreeMap<>(), actualDays = new TreeMap<>();
    private final List<Slice> slices = new ArrayList<>();
    private final Set<UUID> included = new HashSet<>();
    private CellStyle header, hours, date, timestamp, percent;

    static byte[] create(State state, LocalDate from, LocalDate to, String zone, Instant now) throws IOException {
        Rules.require(from != null && to != null && !to.isBefore(from), "Укажите корректный период экспорта");
        Rules.require(ChronoUnit.DAYS.between(from,to) <= 3660, "Период экспорта не более 3661 дня");
        ZoneId timezone;
        try { timezone=ZoneId.of(zone); } catch(DateTimeException | NullPointerException e) { throw new IllegalArgumentException("Некорректный часовой пояс"); }
        return new AnalyticsExport(state,from,to,timezone,now).write();
    }

    private AnalyticsExport(State state, LocalDate from, LocalDate to, ZoneId zone, Instant now) {
        this.state=state; this.from=from; this.to=to; this.zone=zone; this.now=now;
        begin=from.atStartOfDay(zone).toInstant(); end=to.plusDays(1).atStartOfDay(zone).toInstant();
        state.tasks.stream().filter(t->t.deletedAt==null).forEach(t->tasks.put(t.id,t));
        for(Task t:tasks.values()) {
            double p=0;
            if(t.startAt!=null && !t.status.equals("CANCELED")) {
                var days=clipped(t.startAt,t.endAt);
                p=days.values().stream().mapToDouble(Double::doubleValue).sum();
                if(t.parentId==null) days.forEach((d,h)->planDays.merge(d,h,Double::sum));
            }
            plan.put(t.id,p);
            if(t.startAt!=null && t.startAt.isBefore(end) && t.endAt.isAfter(begin)) include(t);
        }
        for(Entry e:state.entries) if(tasks.containsKey(e.taskId)) {
            if(e.startAt!=null) addInterval(e.id,e.taskId,e.source,e.startAt,e.endAt);
            else if(!e.workDate.isBefore(from) && !e.workDate.isAfter(to)) add(new Slice(e.id,e.taskId,e.source,e.workDate,null,null,e.seconds/3600.0));
        }
        if(state.timer.state.equals("RUNNING") && tasks.containsKey(state.timer.taskId))
            addInterval(null,state.timer.taskId,"RUNNING",state.timer.startedAt,now);
        slices.sort(Comparator.comparing(Slice::date).thenComparing(s->Objects.toString(s.start(),"")));
    }
    private Map<LocalDate,Double> clipped(Instant a, Instant b) {
        return Rules.split(a.isBefore(begin)?begin:a,b.isAfter(end)?end:b,zone);
    }
    private void include(Task t) { while(t!=null) { included.add(t.id); t=tasks.get(t.parentId); } }
    private void addInterval(UUID id,UUID task,String source,Instant a,Instant b) {
        Instant start=a.isBefore(begin)?begin:a, stop=b.isAfter(end)?end:b;
        while(start.isBefore(stop)) {
            LocalDate day=start.atZone(zone).toLocalDate();
            Instant next=day.plusDays(1).atStartOfDay(zone).toInstant();
            Instant finish=next.isBefore(stop)?next:stop;
            add(new Slice(id,task,source,day,start,finish,Duration.between(start,finish).toMillis()/3600000.0));
            start=finish;
        }
    }
    private void add(Slice slice) {
        slices.add(slice); own.merge(slice.taskId(),slice.hours(),Double::sum);
        actualDays.merge(slice.date(),slice.hours(),Double::sum);
        Task t=tasks.get(slice.taskId()); include(t);
        while(t!=null) { total.merge(t.id,slice.hours(),Double::sum); t=tasks.get(t.parentId); }
    }
    private String path(Task t) {
        List<String> names=new ArrayList<>();
        while(t!=null) { names.add(t.title); t=tasks.get(t.parentId); }
        Collections.reverse(names); return String.join(" / ",names);
    }
    private String status(Task t) { return switch(t.status) { case "DONE" -> "Выполнена"; case "CANCELED" -> "Отменена"; case "IN_PROGRESS" -> "В работе"; default -> "Запланирована"; }; }
    private byte[] write() throws IOException {
        try(var wb=new XSSFWorkbook(); var out=new ByteArrayOutputStream()) {
            header=wb.createCellStyle(); header.setFillForegroundColor(IndexedColors.DARK_GREEN.getIndex()); header.setFillPattern(FillPatternType.SOLID_FOREGROUND);
            var font=wb.createFont(); font.setBold(true); font.setColor(IndexedColors.WHITE.getIndex()); header.setFont(font); header.setWrapText(true);
            hours=style(wb,"0.00;[Red]-0.00;0.00"); date=style(wb,"dd.mm.yyyy"); timestamp=style(wb,"dd.mm.yyyy hh:mm:ss"); percent=style(wb,"0.0%");
            Sheet summary=wb.createSheet("Сводка"), daily=wb.createSheet("По дням"), detail=wb.createSheet("Задачи"), entries=wb.createSheet("Учёт времени");
            row(summary,0,"Анализ времени и выполнения");
            row(summary,1,"Начало периода",from,"Конец периода",to);
            row(summary,2,"Часовой пояс",zone.getId(),"Снимок",now.atZone(zone).toLocalDateTime(),"Ревизия",state.revision);
            row(summary,3,"План, ч","Факт, ч","Факт − план, ч","Факт / план","Задач по плану","Выполнено из плана","Выполнение плана");
            head(summary,3);
            List<Task> roots=tasks.values().stream().filter(t->t.parentId==null && included.contains(t.id)).sorted(Comparator.comparingDouble((Task t)->total.getOrDefault(t.id,0.0)).reversed().thenComparing(t->t.title)).toList();
            long scheduled=roots.stream().filter(t->plan.get(t.id)>0).count(), done=roots.stream().filter(t->plan.get(t.id)>0 && t.status.equals("DONE")).count();
            row(summary,4,0d,0d,0d,0d,scheduled,done,0d);
            formula(summary,4,0,roots.isEmpty()?"0":"SUM(C16:C"+(15+roots.size())+")",hours);
            formula(summary,4,1,roots.isEmpty()?"0":"SUM(D16:D"+(15+roots.size())+")",hours);
            formula(summary,4,2,"B5-A5",hours);
            formula(summary,4,3,"IF(A5=0,\"\",B5/A5)",percent);
            formula(summary,4,6,"IF(E5=0,\"\",F5/E5)",percent);
            row(summary,6,"Выполнение: доля DONE среди корневых неотменённых задач с планом в периоде. Статусы на момент выгрузки, не исторический срез.");
            row(summary,7,"Факт / план — расход часов, а не процент готовности. Положительное отклонение означает больше часов, отрицательное — меньше.");
            row(summary,8,"План и факт обрезаны границами периода. План — только корни; факт включает потомков ровно один раз. Корзина исключена.");
            row(summary,9,"Отменённые задачи не дают плановых часов, но их фактическая работа учитывается. Работа без плана также включена.");
            row(summary,10,"Активный таймер включён до момента снимка (RUNNING). Экспорт не останавливает и не изменяет таймер.");
            row(summary,11,"Лист «Задачи»: суммировать можно вклад в общий план и собственный факт. Интервалы и суммарный факт уровней не складывать.");
            row(summary,12,"Учёт времени разбит по календарным дням; интервалы ограничены периодом. Ручная длительность относится к указанной дате.");
            row(summary,13,"Фильтры списка не применяются. Отчёт использует текущий изменяемый план, а не первоначальную оценку; без плана доля часов пустая.");
            row(summary,14,"Корневая задача","Статус","План, ч","Факт дерева, ч","Факт − план, ч","Факт / план","В плане периода","ID"); head(summary,14);
            int r=15;
            for(Task t:roots) { row(summary,r,t.title,status(t),plan.get(t.id),total.getOrDefault(t.id,0.0),0d,0d,plan.get(t.id)>0?"Да":"Нет",t.id.toString()); formula(summary,r,4,"D"+(r+1)+"-C"+(r+1),hours); formula(summary,r,5,"IF(C"+(r+1)+"=0,\"\",D"+(r+1)+"/C"+(r+1)+")",percent); r++; }
            table(summary,14,r-1,8); summary.createFreezePane(2,15); summary.setColumnWidth(0,48*256);
            CellStyle note=wb.createCellStyle(); note.setWrapText(true);
            for(int i=6;i<=13;i++) { summary.addMergedRegion(new CellRangeAddress(i,i,0,7)); summary.getRow(i).setHeightInPoints(30); summary.getRow(i).getCell(0).setCellStyle(note); }

            row(daily,0,"Дата","План, ч","Факт, ч","Факт − план, ч","Факт / план"); head(daily,0); r=1;
            for(LocalDate d=from;!d.isAfter(to);d=d.plusDays(1)) { row(daily,r,d,planDays.getOrDefault(d,0.0),actualDays.getOrDefault(d,0.0),0d,0d); formula(daily,r,3,"C"+(r+1)+"-B"+(r+1),hours); formula(daily,r,4,"IF(B"+(r+1)+"=0,\"\",C"+(r+1)+"/B"+(r+1)+")",percent); r++; } table(daily,0,r-1,5);
            row(detail,0,"ID","Родитель ID","Путь задачи","Статус","Исполнитель","Начало плана","Конец плана","Интервал в периоде, ч","Вклад в общий план, ч","Собственный факт, ч","Факт с потомками, ч","Факт дерева − интервал, ч","Выполнена (1/0)","Завершена в","Просрочена (1/0)"); head(detail,0); r=1;
            for(Task t:tasks.values().stream().filter(t->included.contains(t.id)).sorted(Comparator.comparing(this::path)).toList()) {
                row(detail,r,t.id.toString(),Objects.toString(t.parentId,""),path(t),status(t),t.assignee,local(t.startAt),local(t.endAt),plan.get(t.id),t.parentId==null?plan.get(t.id):0d,own.getOrDefault(t.id,0.0),total.getOrDefault(t.id,0.0),0d,t.status.equals("DONE")?1:0,local(t.completedAt),Rules.overdue(t,now)?1:0);
                formula(detail,r,11,"K"+(r+1)+"-H"+(r+1),hours); r++;
            } table(detail,0,r-1,15); detail.setColumnWidth(2,60*256);
            row(entries,0,"Запись ID","Задача ID","Путь задачи","Дата работы","Начало в зоне отчёта","Конец в зоне отчёта","Часы в этом дне","Источник","Начало UTC","Конец UTC"); head(entries,0); r=1;
            for(Slice s:slices) row(entries,r++,Objects.toString(s.entryId(),"Активный таймер"),s.taskId().toString(),path(tasks.get(s.taskId())),s.date(),local(s.start()),local(s.end()),s.hours(),s.source(),Objects.toString(s.start(),""),Objects.toString(s.end(),""));
            table(entries,0,r-1,10); entries.setColumnWidth(2,60*256);
            wb.getCreationHelper().createFormulaEvaluator().evaluateAll(); wb.write(out); return out.toByteArray();
        }
    }
    private LocalDateTime local(Instant i) { return i==null?null:i.atZone(zone).toLocalDateTime(); }
    private CellStyle style(Workbook w,String format) { CellStyle s=w.createCellStyle(); s.setDataFormat(w.createDataFormat().getFormat(format)); return s; }
    private void row(Sheet sheet,int index,Object... values) {
        Row row=sheet.createRow(index);
        for(int i=0;i<values.length;i++) {
            Cell cell=row.createCell(i); Object v=values[i];
            if(v instanceof Double n) { cell.setCellValue(n); cell.setCellStyle(hours); }
            else if(v instanceof Number n) cell.setCellValue(n.doubleValue());
            else if(v instanceof LocalDate d) {cell.setCellValue(d);cell.setCellStyle(date);}
            else if(v instanceof LocalDateTime d) {cell.setCellValue(d);cell.setCellStyle(timestamp);}
            // Explicit string cells prevent task titles from becoming Excel formulas.
            else if(v!=null) { String text=v.toString(); cell.setCellValue(text.length()>32767?text.substring(0,32767):text); }
        }
    }
    private void head(Sheet s,int r) { s.getRow(r).setHeightInPoints(42); s.getRow(r).forEach(c->c.setCellStyle(header)); }
    private void formula(Sheet s,int r,int c,String f,CellStyle style) { Cell cell=s.getRow(r).getCell(c);cell.setCellFormula(f);cell.setCellStyle(style); }
    private void table(Sheet s,int headerRow,int lastRow,int columns) {
        s.createFreezePane(0,headerRow+1); s.setAutoFilter(new CellRangeAddress(headerRow,Math.max(headerRow,lastRow),0,columns-1));
        for(int c=0;c<columns;c++) s.setColumnWidth(c,24*256);
    }
}
