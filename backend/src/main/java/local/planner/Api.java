package local.planner;
import org.springframework.web.bind.annotation.*;
import org.springframework.http.*;
import java.time.*;
import java.util.*;
@RestController
@RequestMapping("/api/v1")
public class Api {
    private final PlannerService service;
    public Api(PlannerService service) { this.service=service; }
    @PostMapping("/activity") @ResponseStatus(HttpStatus.NO_CONTENT) public void activity() {}
    @GetMapping({"/state","/backup/export"}) public Model.State state() { return service.read(); }
    @GetMapping("/tasks") public List<Model.Task> tasks(@RequestParam(required=false) Instant from,@RequestParam(required=false) Instant to,@RequestParam(defaultValue="") String q,@RequestParam(required=false) String status,@RequestParam(required=false) String priority,@RequestParam(required=false) String assignee,@RequestParam(defaultValue="false") boolean overdue) {
        return service.read().tasks.stream().filter(t->t.deletedAt==null&&(from==null||t.endAt!=null&&t.endAt.isAfter(from))&&(to==null||t.startAt!=null&&t.startAt.isBefore(to))&&(t.title+" "+t.description).toLowerCase().contains(q.toLowerCase())&&(status==null||t.status.equals(status))&&(priority==null||t.priority.equals(priority))&&(assignee==null||t.assignee.equals(assignee))&&(!overdue||Rules.overdue(t,Instant.now()))).toList();
    }
    @GetMapping("/stats") public Map<String,Object> stats(@RequestParam LocalDate from,@RequestParam LocalDate to,@RequestParam String zone) { return service.stats(service.read(),from,to,zone); }
    @GetMapping("/analytics/export") public ResponseEntity<byte[]> analytics(@RequestParam LocalDate from,@RequestParam LocalDate to,@RequestParam String zone) throws java.io.IOException {
        byte[] workbook = AnalyticsExport.create(service.read(),from,to,zone,Instant.now());
        return ResponseEntity.ok().contentType(MediaType.parseMediaType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"))
            .header(HttpHeaders.CONTENT_DISPOSITION,"attachment; filename=planner-analysis-"+from+"-"+to+".xlsx")
            .header(HttpHeaders.CACHE_CONTROL,"no-store").body(workbook);
    }
    @PostMapping("/{resource}/{action}") public PlannerService.Result mutate(@PathVariable String resource,@PathVariable String action,@RequestBody PlannerService.Command cmd) { return service.mutate(resource,action,cmd); }
    @ExceptionHandler(PlannerService.Decision.class) ResponseEntity<?> decision(PlannerService.Decision e) { return ResponseEntity.status(409).body(Map.of("code","CONFIRM_REQUIRED","message",e.getMessage(),"details",e.result)); }
    @ExceptionHandler(PlannerService.Stale.class) ResponseEntity<?> stale(PlannerService.Stale e) { return ResponseEntity.status(409).body(Map.of("code","STALE_REVISION","message",e.getMessage())); }
    @ExceptionHandler({IllegalArgumentException.class,org.springframework.http.converter.HttpMessageNotReadableException.class,org.springframework.web.method.annotation.MethodArgumentTypeMismatchException.class}) ResponseEntity<?> invalid(Exception e) { return ResponseEntity.badRequest().body(Map.of("code","VALIDATION","message",e instanceof IllegalArgumentException?Objects.toString(e.getMessage(),"Некорректные данные"):"Некорректная структура запроса")); }
    @ExceptionHandler(Exception.class) ResponseEntity<?> failure(Exception e) { org.slf4j.LoggerFactory.getLogger(Api.class).error("Operation failed",e); return ResponseEntity.status(500).body(Map.of("code","INTERNAL","message","Операция не выполнена. Данные не изменены. Проверьте журнал сервера.")); }
}
