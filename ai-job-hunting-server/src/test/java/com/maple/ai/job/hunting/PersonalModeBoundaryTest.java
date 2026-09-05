package com.maple.ai.job.hunting;

import com.maple.ai.job.hunting.common.HeaderContext;
import com.maple.ai.job.hunting.config.AppBizConfig;
import com.maple.ai.job.hunting.config.ProductPermissionConfig;
import com.maple.ai.job.hunting.controller.ALiPayController;
import com.maple.ai.job.hunting.controller.UserInvitesController;
import com.maple.ai.job.hunting.frame.filter.LoginFilter;
import com.maple.ai.job.hunting.frame.filter.ProductFilter;
import com.maple.ai.job.hunting.frame.cache.SysSessionCache;
import com.maple.ai.job.hunting.frame.exp.ApplicationException;
import com.maple.ai.job.hunting.mapper.UserProductMapper;
import com.maple.ai.job.hunting.mapper.UserTrialMapper;
import com.maple.ai.job.hunting.model.vo.UserInfoVO;
import com.maple.ai.job.hunting.service.biz.*;
import jakarta.servlet.FilterChain;
import org.junit.jupiter.api.*;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;
import java.util.List;
import java.util.Properties;
import java.nio.file.Files;
import java.nio.file.Path;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class PersonalModeBoundaryTest {
    AppBizConfig config;
    ProductFilter products;
    UserProductMapper productMapper;
    UserTrialMapper trials;
    @BeforeEach void setup() {
        config = new AppBizConfig();
        ReflectionTestUtils.setField(config, "personalMode", true);
        products = new ProductFilter();
        ProductPermissionConfig permissions = new ProductPermissionConfig(); permissions.initDefaultPermissions();
        productMapper = mock(UserProductMapper.class); trials = mock(UserTrialMapper.class);
        ReflectionTestUtils.setField(products, "appBizConfig", config);
        ReflectionTestUtils.setField(products, "productPermissionConfig", permissions);
        ReflectionTestUtils.setField(products, "userProductMapper", productMapper);
        ReflectionTestUtils.setField(products, "userTrialMapper", trials);
    }
    @AfterEach void cleanup() { HeaderContext.clear(); }
    @Test void personalEndpointsDoNotConsumeTrials() throws Exception {
        UserInfoVO user = new UserInfoVO(); user.setId(3L);
        HeaderContext.initHeader(user, false, "127.0.0.1", "/api/job/filter/one");
        for (String endpoint : List.of("/api/job/filter/one", "/api/job/seeker/cloned/ask",
                "/api/user/ai/config/save", "/api/user/ai/config/debug", "/api/job/ai/assistant/generate/greeting")) {
            MockHttpServletRequest request = new MockHttpServletRequest("POST", endpoint);
            MockHttpServletResponse response = new MockHttpServletResponse(); FilterChain chain = mock(FilterChain.class);
            products.doFilter(request, response, chain); verify(chain).doFilter(request, response);
        }
        verifyNoInteractions(productMapper, trials);
    }
    @Test void productGateNeverAcceptsAnonymousPersonalRequests() {
        FilterChain chain = mock(FilterChain.class);
        assertThrows(ApplicationException.class, () -> products.doFilter(
                new MockHttpServletRequest("POST", "/api/job/filter/one"), new MockHttpServletResponse(), chain));
        verifyNoInteractions(chain, productMapper, trials);
    }
    @Test void loginIsStillRequiredInPersonalMode() {
        LoginFilter login = new LoginFilter(); FilterChain chain = mock(FilterChain.class);
        ReflectionTestUtils.setField(login, "appBizConfig", config);
        ReflectionTestUtils.setField(login, "freeLoginList", List.of());
        ReflectionTestUtils.setField(login, "sysSessionCache", mock(SysSessionCache.class));
        assertThrows(ApplicationException.class, () -> login.doFilter(
                new MockHttpServletRequest("POST", "/api/user/save/preference"), new MockHttpServletResponse(), chain));
        verifyNoInteractions(chain);
    }
    ApplicationContextRunner salesContext() {
        return new ApplicationContextRunner().withUserConfiguration(ALiPayController.class, UserInvitesController.class)
                .withInitializer(context -> {
                    context.getBeanFactory().registerSingleton("aLiPayService", mock(ALiPayService.class));
                    context.getBeanFactory().registerSingleton("sseService", mock(SseService.class));
                    context.getBeanFactory().registerSingleton("userInvitesService", mock(UserInvitesService.class));
                });
    }
    @Test void salesControllersAreAbsentInPersonalMode() {
        salesContext().withPropertyValues("app.personal-mode=true").run(context -> {
            assertNull(context.getStartupFailure());
            assertTrue(context.getBeansOfType(ALiPayController.class).isEmpty());
            assertTrue(context.getBeansOfType(UserInvitesController.class).isEmpty());
        });
    }
    @Test void commercialControllersRemainAvailableWhenExplicitlyRestored() {
        salesContext().withPropertyValues("app.personal-mode=false").run(context -> {
            assertNull(context.getStartupFailure());
            assertEquals(1, context.getBeansOfType(ALiPayController.class).size());
            assertEquals(1, context.getBeansOfType(UserInvitesController.class).size());
        });
    }
    @Test void localProfileUsesTheActualPersonalModeProperty() throws Exception {
        Properties local = new Properties();
        try (var input = Files.newInputStream(Path.of("application-local.properties"))) { local.load(input); }
        assertEquals("${JOB_HELPER_PERSONAL_MODE:true}", local.getProperty("app.personal-mode"));
        assertNull(local.getProperty("product.permission.enabled"));
    }
}
