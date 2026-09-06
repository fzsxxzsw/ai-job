package com.maple.ai.job.hunting;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.maple.ai.job.hunting.common.HeaderContext;
import com.maple.ai.job.hunting.config.AppBizConfig;
import com.maple.ai.job.hunting.controller.RejectionGatewayController;
import com.maple.ai.job.hunting.frame.cache.SysSessionCache;
import com.maple.ai.job.hunting.frame.exp.ApplicationException;
import com.maple.ai.job.hunting.frame.filter.LoginFilter;
import com.maple.ai.job.hunting.model.vo.UserInfoVO;
import com.maple.ai.job.hunting.service.biz.RejectionGateway;
import com.maple.ai.job.hunting.service.biz.RejectionGateway.Operation;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.*;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class RejectionGatewayTest {
    static final String SECRET = "test-only-gateway-secret-".repeat(2);
    HttpServer server;
    String endpoint;
    RejectionGateway gateway;
    AtomicInteger calls;
    AtomicReference<String> user, authorization, target, content, signature, timestamp, nonce;
    AtomicReference<String> response;
    AtomicInteger status;

    @BeforeEach void setup() throws Exception {
        calls = new AtomicInteger(); status = new AtomicInteger(200);
        user=new AtomicReference<>(); authorization=new AtomicReference<>(); target=new AtomicReference<>();
        content=new AtomicReference<>(); signature=new AtomicReference<>(); timestamp=new AtomicReference<>(); nonce=new AtomicReference<>();
        response=new AtomicReference<>("{\"code\":200,\"data\":{\"implementation\":\"python\"},\"message\":\"ok\"}");
        server = HttpServer.create(new InetSocketAddress("127.0.0.1",0),0);
        server.createContext("/",exchange -> {
            calls.incrementAndGet(); target.set(exchange.getRequestURI().toString());
            user.set(exchange.getRequestHeaders().getFirst("X-JH-User"));
            authorization.set(exchange.getRequestHeaders().getFirst("Authorization"));
            signature.set(exchange.getRequestHeaders().getFirst("X-JH-Signature"));
            timestamp.set(exchange.getRequestHeaders().getFirst("X-JH-Timestamp"));
            nonce.set(exchange.getRequestHeaders().getFirst("X-JH-Nonce"));
            content.set(new String(exchange.getRequestBody().readAllBytes(),StandardCharsets.UTF_8));
            byte[] bytes=response.get().getBytes(StandardCharsets.UTF_8);
            exchange.getResponseHeaders().set("Content-Type","application/json");
            if (status.get()==302) exchange.getResponseHeaders().set("Location","/must-not-follow");
            exchange.sendResponseHeaders(status.get(),bytes.length);
            exchange.getResponseBody().write(bytes); exchange.close();
        });
        server.start(); endpoint="http://127.0.0.1:"+server.getAddress().getPort();
        gateway=new RejectionGateway(new ObjectMapper(),true,endpoint,SECRET);
        UserInfoVO info=new UserInfoVO(); info.setId(3L);
        HeaderContext.initHeader(info,false,"127.0.0.1","/api/job/ai/rejections/analyze");
    }
    @AfterEach void cleanup() { HeaderContext.clear(); server.stop(0); }

    @Test void crossLanguageSignatureMatchesPythonGolden() throws Exception {
        assertEquals("fe4eb765aaa7e86b3d1b0f160945e5c52298f207b1da8430f9c5961320143082",
                RejectionGateway.signature(SECRET,"POST","/internal/rejections/analyze",3,
                        "1712345678","0".repeat(32),"{\"message\":\"岗位\"}".getBytes(StandardCharsets.UTF_8)));
    }

    @Test void gatewayUsesSessionIdentityAndSignsExactUtf8Body() throws Exception {
        byte[] body="{\"messages\":[{\"role\":\"HR\",\"text\":\"岗位已招满\"}]}".getBytes(StandardCharsets.UTF_8);
        assertEquals(200,gateway.forward(Operation.ANALYZE,null,body).getCode());
        assertEquals("3",user.get()); assertNull(authorization.get());
        assertEquals("/internal/rejections/analyze",target.get());
        assertEquals(RejectionGateway.signature(SECRET,"POST",target.get(),3,timestamp.get(),nonce.get(),body),signature.get());
        assertArrayEquals(body,content.get().getBytes(StandardCharsets.UTF_8));
    }

    @Test void callerHeadersCannotOverrideAuthenticatedUser() throws Exception {
        MockHttpServletRequest request=new MockHttpServletRequest("POST","/api/job/ai/rejections/analyze");
        request.addHeader("X-JH-User","9"); request.addHeader("Authorization","browser-login-must-not-leak");
        request.setContent("{}".getBytes(StandardCharsets.UTF_8));
        assertEquals(200,new RejectionGatewayController(gateway).analyze(request).getCode());
        assertEquals("3",user.get()); assertNull(authorization.get());
    }

    @Test void absentLoginNeverCallsPython() {
        HeaderContext.clear();
        assertEquals(401,gateway.forward(Operation.SUMMARY,null,new byte[0]).getCode());
        assertEquals(0,calls.get());
    }

    @Test void existingLoginFilterRemainsTheTrustBoundary() throws Exception {
        HeaderContext.clear();
        LoginFilter filter=new LoginFilter(); SysSessionCache cache=mock(SysSessionCache.class);
        AppBizConfig config=mock(AppBizConfig.class); UserInfoVO info=new UserInfoVO(); info.setId(3L);
        when(config.getAdminUserIdList()).thenReturn(List.of(1L));
        when(cache.contains("valid-session")).thenReturn(true); when(cache.get("valid-session")).thenReturn(info);
        ReflectionTestUtils.setField(filter,"sysSessionCache",cache);
        ReflectionTestUtils.setField(filter,"appBizConfig",config);
        ReflectionTestUtils.setField(filter,"freeLoginList",List.of());
        MockHttpServletRequest request=new MockHttpServletRequest("GET","/api/job/ai/rejections/summary");
        request.addHeader("X-JH-User","9");
        assertThrows(ApplicationException.class,()->filter.doFilter(request,new MockHttpServletResponse(),(a,b)->fail("must not reach controller")));
        request.addHeader("Authorization","valid-session");
        filter.doFilter(request,new MockHttpServletResponse(),(a,b)->assertEquals(200,gateway.forward(Operation.SUMMARY,null,new byte[0]).getCode()));
        assertEquals("3",user.get()); assertEquals(-1L,HeaderContext.getHeader().getUserId());
    }

    @Test void featureFlagDoesNotCallPython() {
        assertEquals(503,new RejectionGateway(new ObjectMapper(),false,endpoint,SECRET).forward(Operation.SUMMARY,null,new byte[0]).getCode());
        assertEquals(0,calls.get());
    }
    @Test void rejectsUnboundedBodyInvalidIdAndQuery() throws Exception {
        assertEquals(413,gateway.forward(Operation.ANALYZE,null,new byte[256001]).getCode());
        assertEquals(422,gateway.forward(Operation.REPORT,-1L,new byte[0]).getCode());
        MockHttpServletRequest request=new MockHttpServletRequest(); request.setQueryString("userId=9");
        assertEquals(422,new RejectionGatewayController(gateway).summary(request).getCode());
        assertEquals(0,calls.get());
    }
    @Test void noArbitraryDestinationOrRedirects() {
        assertEquals(503,new RejectionGateway(new ObjectMapper(),true,"http://example.invalid:9101",SECRET).forward(Operation.SUMMARY,null,new byte[0]).getCode());
        assertEquals(0,calls.get()); status.set(302);
        assertNotEquals(200,gateway.forward(Operation.SUMMARY,null,new byte[0]).getCode());
        assertEquals(1,calls.get());
    }
    @Test void internalAuthenticationFailureDoesNotInvalidateBrowserLogin() {
        status.set(401); response.set("{\"code\":401,\"message\":\"internal\"}");
        assertEquals(502,gateway.forward(Operation.SUMMARY,null,new byte[0]).getCode());
    }
    @Test void malformedUpstreamFailsClosed() {
        response.set("not json");
        assertNotEquals(200,gateway.forward(Operation.SUMMARY,null,new byte[0]).getCode());
    }
}
