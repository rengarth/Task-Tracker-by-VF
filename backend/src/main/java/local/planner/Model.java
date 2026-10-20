package local.planner;
import java.time.*;
import java.util.*;
public final class Model {
    public static class Task {
        public UUID id = UUID.randomUUID(), parentId, seriesId;
        public String title = "", description = "", assignee = "Я", priority = "NORMAL", status = "PLANNED";
        public Instant startAt, endAt, completedAt, createdAt = Instant.now(), updatedAt = Instant.now(), deletedAt;
        public int sortOrder;
        public boolean exception;
        public LocalDate occurrenceDate;
    }
    public static class Checklist {
        public UUID id = UUID.randomUUID(), taskId;
        public String title = "Чек-лист";
        public int sortOrder;
    }
    public static class Item {
        public UUID id = UUID.randomUUID(), checklistId;
        public String text = "";
        public boolean done;
        public int sortOrder;
    }
    public static class Comment {
        public UUID id = UUID.randomUUID(), taskId;
        public String text = "";
        public Instant createdAt = Instant.now(), updatedAt = Instant.now();
    }
    public static class Entry {
        public UUID id = UUID.randomUUID(), taskId;
        public String source = "MANUAL";
        public Instant startAt, endAt;
        public LocalDate workDate;
        public long seconds;
    }
    public static class Timer {
        public UUID taskId;
        public Instant startedAt;
        public String state = "STOPPED";
    }
    public static class Series {
        public UUID id = UUID.randomUUID(), templateId;
        public String frequency = "DAILY", zone = "Europe/Moscow";
        public List<Integer> weekdays = new ArrayList<>();
        public int count = 10;
        public LocalDate until;
    }
    public static class TaskTemplate {
        public UUID id = UUID.randomUUID();
        public String name = "", title = "", description = "", assignee = "Я", priority = "NORMAL";
        public List<String> checklistItems = new ArrayList<>();
    }
    public static class AuditEntry {
        public UUID id = UUID.randomUUID(), taskId;
        public Instant createdAt = Instant.now();
        public long revision;
        public int sequence;
        public String action = "", detail = "";
    }
    public static class State {
        public int schemaVersion = 1;
        public long revision;
        public List<Task> tasks = new ArrayList<>();
        public List<Checklist> checklists = new ArrayList<>();
        public List<Item> items = new ArrayList<>();
        public List<Comment> comments = new ArrayList<>();
        public List<Entry> entries = new ArrayList<>();
        public List<Series> series = new ArrayList<>();
        public List<TaskTemplate> templates = new ArrayList<>();
        public List<AuditEntry> audit = new ArrayList<>();
        public Timer timer = new Timer();
    }
}
