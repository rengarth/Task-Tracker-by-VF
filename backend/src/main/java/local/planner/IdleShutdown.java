package local.planner;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.time.Duration;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicLong;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.SpringApplication;
import org.springframework.context.ConfigurableApplicationContext;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

@Component
public class IdleShutdown extends OncePerRequestFilter {
    private static final Logger log = LoggerFactory.getLogger(IdleShutdown.class);
    private final long timeoutNanos;
    private final ConfigurableApplicationContext context;
    private final AtomicLong lastActivity = new AtomicLong(System.nanoTime());
    private final AtomicInteger activeRequests = new AtomicInteger();
    private final AtomicBoolean stopping = new AtomicBoolean();

    public IdleShutdown(
        @Value("${planner.idle-timeout:PT5H}") Duration timeout,
        ConfigurableApplicationContext context
    ) {
        if (timeout.isZero() || timeout.isNegative()) throw new IllegalArgumentException("Idle timeout must be positive");
        this.timeoutNanos = timeout.toNanos();
        this.context = context;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
        throws ServletException, IOException {
        activeRequests.incrementAndGet();
        if (!request.getRequestURI().equals("/api/v1/stats")) lastActivity.set(System.nanoTime());
        try {
            chain.doFilter(request, response);
        } finally {
            activeRequests.decrementAndGet();
        }
    }

    @Scheduled(fixedDelayString = "${planner.idle-check-interval-ms:60000}")
    void checkIdle() {
        if (activeRequests.get() != 0 || System.nanoTime() - lastActivity.get() < timeoutNanos) return;
        if (!stopping.compareAndSet(false, true)) return;
        log.info("No user activity for {} minutes; stopping the planner", TimeUnit.NANOSECONDS.toMinutes(timeoutNanos));
        Thread shutdown = new Thread(() -> System.exit(SpringApplication.exit(context, () -> 0)), "planner-idle-shutdown");
        shutdown.start();
    }
}
