package com.maple.ai.job.hunting.service.biz;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.maple.ai.job.hunting.common.HeaderContext;
import com.maple.ai.job.hunting.model.common.Response;
import okhttp3.*;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import javax.crypto.Mac;
import javax.crypto.spec.SecretKeySpec;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.time.Instant;
import java.util.HexFormat;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

/** Fixed-route gateway only. All rejection business logic lives in Python. */
@Service
public class RejectionGateway {
    public enum Operation { SNAPSHOT, ANALYZE, FEEDBACK, REPORT, SUMMARY, HISTORY, STATUS }
    private static final String PREFIX = "/internal/rejections";
    private final ObjectMapper mapper;
    private final boolean enabled;
    private final String endpoint;
    private final String secret;
    private final OkHttpClient client = new OkHttpClient.Builder()
            .connectTimeout(2, TimeUnit.SECONDS).readTimeout(16, TimeUnit.SECONDS)
            .callTimeout(16, TimeUnit.SECONDS).followRedirects(false).followSslRedirects(false)
            .retryOnConnectionFailure(false).build();

    public RejectionGateway(ObjectMapper mapper,
            @Value("${REJECTION_GATEWAY_ENABLED:false}") boolean enabled,
            @Value("${REJECTION_INTERNAL_URL:http://agent:9101}") String endpoint,
            @Value("${REJECTION_GATEWAY_SECRET:}") String secret) {
        this.mapper = mapper; this.enabled = enabled; this.endpoint = endpoint; this.secret = secret;
    }

    public static String signature(String secret, String method, String path, long userId,
                                   String timestamp, String nonce, byte[] body) throws Exception {
        String hash = HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256").digest(body));
        String canonical = String.join("\n", "jh-rejection-v1", method, path,
                Long.toString(userId), timestamp, nonce, hash);
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(secret.getBytes(StandardCharsets.US_ASCII), "HmacSHA256"));
        return HexFormat.of().formatHex(mac.doFinal(canonical.getBytes(StandardCharsets.UTF_8)));
    }

    private String baseUrl() {
        URI uri = URI.create(endpoint);
        if (!"http".equals(uri.getScheme()) || !Set.of("agent", "127.0.0.1", "localhost").contains(uri.getHost())
                || uri.getUserInfo() != null || uri.getQuery() != null || uri.getFragment() != null
                || !(uri.getPath().isEmpty() || uri.getPath().equals("/"))
                || uri.getPort() < 1 || ("agent".equals(uri.getHost()) && uri.getPort() != 9101)) {
            throw new IllegalArgumentException("Invalid internal endpoint");
        }
        return endpoint.replaceAll("/+$", "");
    }

    public Response<JsonNode> forward(Operation operation, Long id, byte[] body) {
        Long uid = HeaderContext.getHeader().getUserId();
        if (uid == null || uid <= 0 || uid > 9007199254740991L) return Response.error(401, "请先登录");
        if (!enabled || secret.length() < 32 || !StandardCharsets.US_ASCII.newEncoder().canEncode(secret)) {
            return Response.error(503, "拒绝分析尚未启用，请检查服务端配置");
        }
        if (body == null || body.length > 256000) return Response.error(413, "请求内容超过限制");
        boolean get = Set.of(Operation.REPORT,Operation.SUMMARY,Operation.HISTORY,Operation.STATUS).contains(operation);
        if (get && body.length != 0) return Response.error(422, "查询接口不接受请求正文");
        if (Set.of(Operation.REPORT,Operation.FEEDBACK).contains(operation)
                && (id == null || id <= 0 || id > 9007199254740991L)) return Response.error(422, "分析编号无效");
        String path = PREFIX + switch (operation) {
            case SNAPSHOT -> "/snapshot"; case ANALYZE -> "/analyze";
            case FEEDBACK -> "/reports/" + id + "/feedback"; case REPORT -> "/reports/" + id;
            case SUMMARY -> "/summary"; case HISTORY -> "/history"; case STATUS -> "/status";
        };
        String method = get ? "GET" : "POST";
        String timestamp = Long.toString(Instant.now().getEpochSecond());
        String nonce = UUID.randomUUID().toString().replace("-", "");
        try {
            Request.Builder builder = new Request.Builder().url(baseUrl() + path)
                    .header("X-JH-User", uid.toString()).header("X-JH-Timestamp", timestamp)
                    .header("X-JH-Nonce", nonce)
                    .header("X-JH-Signature", signature(secret,method,path,uid,timestamp,nonce,body));
            if (get) builder.get();
            else builder.post(RequestBody.create(body, MediaType.get("application/json; charset=utf-8")));
            try (okhttp3.Response upstream = client.newCall(builder.build()).execute()) {
                if (upstream.body() == null) return Response.error(502, "Python拒绝分析返回空响应");
                byte[] bytes = upstream.body().byteStream().readNBytes(1_000_001);
                if (bytes.length > 1_000_000) return Response.error(502, "Python拒绝分析响应超过限制");
                JsonNode result = mapper.readTree(bytes);
                if (result == null || !result.isObject()) return Response.error(502, "Python拒绝分析响应格式不正确");
                int code = result.path("code").asInt(502);
                if (upstream.code() == 200 && code == 200 && result.has("data")) return Response.success(result.get("data"));
                if (code < 400 || code > 599 || code != upstream.code()) code = 502;
                // Internal authentication failures are configuration errors, not expired browser login.
                if (code == 401) return Response.error(502, "拒绝分析内部身份校验失败，请检查服务端配置");
                String message = result.path("message").asText("拒绝分析暂不可用");
                return Response.error(code, message.substring(0, Math.min(message.length(), 500)));
            }
        } catch (Exception ignored) {
            // No request bodies, credentials, provider output or personal evidence in logs.
            return Response.error(503, "Python拒绝分析服务连接失败或超时，现有筛选和回复服务不受此接口影响");
        }
    }
}
