package local.planner;
import java.util.*;
import static local.planner.Model.*;
import static local.planner.Rules.require;

final class Checklists {
    /** Also accepts legacy backups with several lists, retaining item identity and completion. */
    static void normalize(State s) {
        Map<UUID,List<Checklist>> groups=new LinkedHashMap<>();
        s.checklists.stream().sorted(Comparator.comparingInt((Checklist c)->c.sortOrder).thenComparing(c->c.id)).forEach(c->groups.computeIfAbsent(c.taskId,k->new ArrayList<>()).add(c));
        for(var group:groups.values()) {
            Checklist keep=group.getFirst(); keep.title="Чек-лист";
            if(group.size()==1) continue;
            int order=0;
            for(Checklist list:group) for(Item item:s.items.stream().filter(i->i.checklistId.equals(list.id)).sorted(Comparator.comparingInt((Item i)->i.sortOrder).thenComparing(i->i.id)).toList()) {
                item.checklistId=keep.id; item.sortOrder=order++;
            }
            s.checklists.removeIf(c->group.contains(c)&&c!=keep);
        }
    }
    static void reorder(State s,UUID checklist,List<UUID> ids) {
        Set<UUID> expected=new HashSet<>();s.items.stream().filter(i->i.checklistId.equals(checklist)).forEach(i->expected.add(i.id));
        require(s.checklists.stream().anyMatch(c->c.id.equals(checklist)),"Чек-лист не найден");
        require(ids.size()==expected.size()&&new HashSet<>(ids).equals(expected),"Порядок должен содержать все пункты чек-листа ровно один раз");
        for(Item item:s.items) if(item.checklistId.equals(checklist)) item.sortOrder=ids.indexOf(item.id);
    }
}
