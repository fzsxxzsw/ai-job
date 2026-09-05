package com.maple.ai.job.hunting.config.ai;

import com.alibaba.fastjson.JSONObject;
import com.maple.ai.job.hunting.common.ai.AIConfigHelper;
import com.maple.ai.job.hunting.frame.exp.ApplicationException;
import com.maple.ai.job.hunting.config.ai.OpenAIPoolConfig.OpenAIPoolManager;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.test.util.ReflectionTestUtils;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.*;

@ExtendWith(OutputCaptureExtension.class)
class LocalModelPoolTest {
    OpenAIPoolManager manager(MockEnvironment environment, List<JSONObject> legacy) {
        OpenAIPoolManager manager = new OpenAIPoolManager();
        ReflectionTestUtils.setField(manager, "environment", environment);
        ReflectionTestUtils.setField(manager, "autoConfigPool", false);
        ReflectionTestUtils.setField(manager, "aiConfigHelper", new AIConfigHelper());
        ReflectionTestUtils.setField(manager, "openaiPoolConfigList", legacy);
        return manager;
    }
    @Test void personalPoolUsesRealEnvironmentInsteadOfEmptyJsonPlaceholders(CapturedOutput output) throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        AtomicReference<String> authorization = new AtomicReference<>();
        AtomicReference<String> requestBody = new AtomicReference<>();
        server.createContext("/v1/chat/completions", exchange -> {
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            requestBody.set(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            byte[] response = ("{\"id\":\"local-test\",\"object\":\"chat.completion\",\"created\":1,"
                    + "\"usage\":{\"prompt_tokens\":1,\"completion_tokens\":1,\"total_tokens\":2},\"model\":\"unit-model\",\"choices\":[{\"index\":0,\"finish_reason\":\"stop\","
                    + "\"message\":{\"role\":\"assistant\",\"content\":\"local-ok\"}}]}").getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type", "application/json");
            exchange.sendResponseHeaders(200, response.length);
            exchange.getResponseBody().write(response); exchange.close();
        });
        server.start();
        try {
            MockEnvironment environment = new MockEnvironment().withProperty("app.personal-mode", "true")
                    .withProperty("AI_API_KEY", "unit-dummy-secret-never-log")
                    .withProperty("AI_BASE_URL", "http://127.0.0.1:" + server.getAddress().getPort() + "/v1")
                    .withProperty("AI_MODEL", "unit-model").withProperty("AI_TIMEOUT_SECONDS", "5");
            JSONObject unresolved = new JSONObject(); unresolved.put("api-key", "");
            OpenAIPoolManager manager = manager(environment, List.of(unresolved)); manager.init();
            assertEquals(1, manager.getPoolSize());
            assertEquals("local-ok", manager.getClient().call("ping"));
            assertEquals("Bearer unit-dummy-secret-never-log", authorization.get());
            assertEquals("unit-model", JSONObject.parseObject(requestBody.get()).getString("model"));
            assertFalse(output.getAll().contains("unit-dummy-secret-never-log"));
        } finally { server.stop(0); }
    }
    @Test void emptyPoolReportsConfigurationErrorInsteadOfDividingByZero() {
        OpenAIPoolManager manager = manager(new MockEnvironment().withProperty("app.personal-mode", "true"), List.of());
        manager.init(); assertEquals(0, manager.getPoolSize());
        ApplicationException error = assertThrows(ApplicationException.class, manager::getClient);
        assertTrue(error.getMessage().contains("AI_API_KEY"));
    }
    @Test void commercialPoolKeepsConfiguredClientsAndSurvivesCounterOverflow() {
        List<JSONObject> entries = java.util.stream.IntStream.range(0, 3).mapToObj(index -> {
            JSONObject entry = new JSONObject(); entry.put("name", "unit-" + index);
            entry.put("api-key", "dummy"); entry.put("base-url", "http://127.0.0.1:1/v1");
            entry.put("chat.options.model", "unit-model"); entry.put("completions-path", "/chat/completions");
            return entry;
        }).toList();
        OpenAIPoolManager manager = manager(new MockEnvironment(), entries); manager.init();
        assertEquals(3, manager.getPoolSize());
        ((AtomicInteger) ReflectionTestUtils.getField(manager, "poolIndex")).set(Integer.MAX_VALUE);
        assertNotNull(manager.getClient()); assertNotNull(manager.getClient()); assertNotNull(manager.getClient());
    }
}
