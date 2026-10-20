package local.planner;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;
import java.util.*;
import static local.planner.Model.*;
@Repository
public class Store {
    private final JdbcTemplate db;
    private final ObjectMapper json;
    public Store(JdbcTemplate db, ObjectMapper json) { this.db = db; this.json = json; }
    public void lock() { db.queryForObject("SELECT revision FROM planner_meta WHERE id=1 FOR UPDATE", Long.class); }
    public State read() {
        State s = new State();
        db.query("SELECT revision,timer FROM planner_meta WHERE id=1", rs -> { s.revision=rs.getLong(1); s.timer=decode(rs.getString(2),Model.Timer.class); });
        s.tasks = rows("tasks", Task.class); s.checklists=rows("checklists",Checklist.class);
        s.items=rows("checklist_items",Item.class); s.comments=rows("comments",Comment.class);
        s.entries=rows("time_entries",Entry.class); s.series=rows("recurrences",Series.class);
        s.templates=rows("task_templates",TaskTemplate.class); s.audit=rows("task_audit",AuditEntry.class);
        return s;
    }
    private <T> List<T> rows(String table, Class<T> type) { return db.query("SELECT data FROM " + table + " ORDER BY id", (rs,n)->decode(rs.getString(1),type)); }
    public <T> T decode(String value, Class<T> type) { try { return json.readValue(value,type); } catch(Exception e) { throw new IllegalArgumentException("Некорректная структура данных: " + type.getSimpleName()); } }
    public String encode(Object value) { try { return json.writeValueAsString(value); } catch(Exception e) { throw new IllegalArgumentException("Невозможно сериализовать данные",e); } }
    public <T> T copy(T value, Class<T> type) { return decode(encode(value),type); }
    public void save(State s) {
        // A single-user aggregate is serialized by planner_meta's row lock. FK constraints remain enabled.
        removeMissing("checklist_items",s.items.stream().map(i->i.id).toList());
        removeMissing("comments",s.comments.stream().map(i->i.id).toList());
        removeMissing("time_entries",s.entries.stream().map(i->i.id).toList());
        removeMissing("checklists",s.checklists.stream().map(i->i.id).toList());
        removeMissing("recurrences",s.series.stream().map(i->i.id).toList());
        removeMissing("task_audit",s.audit.stream().map(i->i.id).toList());
        removeMissing("task_templates",s.templates.stream().map(i->i.id).toList());
        // Task FK is deferred, allowing atomic reparenting / replacement in any UUID order.
        removeMissing("tasks",s.tasks.stream().map(i->i.id).toList());
        for(Task t:s.tasks) db.update("INSERT INTO tasks(id,parent_id,start_at,end_at,status,data) VALUES (?,?,?,?,?,?::jsonb) ON CONFLICT(id) DO UPDATE SET parent_id=excluded.parent_id,start_at=excluded.start_at,end_at=excluded.end_at,status=excluded.status,data=excluded.data WHERE tasks.data IS DISTINCT FROM excluded.data",t.id,t.parentId,t.startAt==null?null:java.sql.Timestamp.from(t.startAt),t.endAt==null?null:java.sql.Timestamp.from(t.endAt),t.status,encode(t));
        for(Series r:s.series) upsert("recurrences","template_id",r.id,r.templateId,r);
        for(Checklist c:s.checklists) upsert("checklists","task_id",c.id,c.taskId,c);
        for(Item i:s.items) upsert("checklist_items","checklist_id",i.id,i.checklistId,i);
        for(Comment c:s.comments) upsert("comments","task_id",c.id,c.taskId,c);
        for(Entry e:s.entries) upsert("time_entries","task_id",e.id,e.taskId,e);
        for(TaskTemplate t:s.templates) db.update("INSERT INTO task_templates(id,data) VALUES (?,?::jsonb) ON CONFLICT(id) DO UPDATE SET data=excluded.data WHERE task_templates.data IS DISTINCT FROM excluded.data",t.id,encode(t));
        for(AuditEntry e:s.audit) db.update("INSERT INTO task_audit(id,task_id,created_at,data) VALUES (?,?,?,?::jsonb) ON CONFLICT(id) DO NOTHING",e.id,e.taskId,java.sql.Timestamp.from(e.createdAt),encode(e));
        db.update("UPDATE planner_meta SET revision=?,timer=?::jsonb WHERE id=1",s.revision,encode(s.timer));
    }
    private void upsert(String table,String foreignKey,UUID id,UUID parent,Object data) {
        db.update("INSERT INTO "+table+" VALUES (?,?,?::jsonb) ON CONFLICT(id) DO UPDATE SET "+foreignKey+"=excluded."+foreignKey+",data=excluded.data WHERE "+table+".data IS DISTINCT FROM excluded.data",id,parent,encode(data));
    }
    private void removeMissing(String table,List<UUID> ids) {
        Set<UUID> keep=new HashSet<>(ids);
        for(UUID id:db.query("SELECT id FROM "+table,(rs,n)->rs.getObject(1,UUID.class))) if(!keep.contains(id)) db.update("DELETE FROM "+table+" WHERE id=?",id);
    }
}
