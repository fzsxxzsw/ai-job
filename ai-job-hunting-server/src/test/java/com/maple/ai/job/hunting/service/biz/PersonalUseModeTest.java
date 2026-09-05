package com.maple.ai.job.hunting.service.biz;

import com.maple.ai.job.hunting.common.HeaderContext;
import com.maple.ai.job.hunting.config.AppBizConfig;
import com.maple.ai.job.hunting.emums.ProductTypeEnum;
import com.maple.ai.job.hunting.frame.cache.ProductNotAuthorizedCache;
import com.maple.ai.job.hunting.frame.exp.ApplicationException;
import com.maple.ai.job.hunting.mapper.*;
import com.maple.ai.job.hunting.model.bo.UserInfoDO;
import com.maple.ai.job.hunting.model.vo.UserInfoVO;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.*;
import org.springframework.test.util.ReflectionTestUtils;
import java.util.Set;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class PersonalUseModeTest {
    AppBizConfig config;
    ProductService products;
    UserProductMapper productMapper;
    UserService users;
    UserInfoMapper infoMapper;
    UserTrialMapper trials;
    UserAIConfigService custom;

    @BeforeEach void setup() {
        config = new AppBizConfig();
        ReflectionTestUtils.setField(config, "personalMode", true);
        productMapper = mock(UserProductMapper.class);
        products = new ProductService();
        ReflectionTestUtils.setField(products, "appBizConfig", config);
        ReflectionTestUtils.setField(products, "userProductMapper", productMapper);
        users = new UserService();
        infoMapper = mock(UserInfoMapper.class);
        trials = mock(UserTrialMapper.class);
        custom = mock(UserAIConfigService.class);
        ReflectionTestUtils.setField(users, "appBizConfig", config);
        ReflectionTestUtils.setField(users, "productService", products);
        ReflectionTestUtils.setField(users, "userInfoMapper", infoMapper);
        ReflectionTestUtils.setField(users, "userTrialMapper", trials);
        ReflectionTestUtils.setField(users, "userResumeMapper", mock(UserResumeMapper.class));
        ReflectionTestUtils.setField(users, "userAIConfigService", custom);
        ReflectionTestUtils.setField(users, "productNotAuthorizedCache", mock(ProductNotAuthorizedCache.class));
        TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), UserInfoDO.class);
        UserInfoVO user = new UserInfoVO(); user.setId(3L);
        HeaderContext.initHeader(user, false, "127.0.0.1", "/api/user/save/preference");
    }
    @AfterEach void clear() { HeaderContext.clear(); }

    @Test void personalModeDefaultsOffOutsideLocalProfile() {
        assertFalse(new AppBizConfig().isPersonalMode());
    }
    @Test void personalCapabilitiesDoNotCreateOrdersOrResetTrials() {
        assertEquals(Set.of(1,2,3,4,5,6,7,8,9), products.queryUserValidAllProductType(3L));
        assertTrue(products.hasProductAbility(3L, ProductTypeEnum.AI_SEAT.getCode()));
        assertTrue(products.hasProductAbilityAll(3L, ProductTypeEnum.AI_SEAT, ProductTypeEnum.AI_FILTER));
        verifyNoInteractions(productMapper, trials);
    }
    @Test void anonymousUserNeverGetsCapabilities() {
        assertTrue(products.queryUserValidAllProductType(null).isEmpty());
        assertTrue(products.queryUserValidAllProductType(0L).isEmpty());
        assertFalse(products.hasProductAbility(null, 1));
        assertFalse(products.hasProductAbilityAll(null, ProductTypeEnum.AI_FILTER));
        assertFalse(HeaderContext.getHeader().isAdmin());
    }
    @Test void commercialModeStillUsesPurchasedCapabilities() {
        ReflectionTestUtils.setField(config, "personalMode", false);
        when(productMapper.queryUserValidAllProductType(3L)).thenReturn(Set.of(7));
        assertTrue(products.hasProductAbility(3L, 7));
        assertFalse(products.hasProductAbility(3L, 1));
    }
    @Test void savingSeatWorksEvenWithNoProductsAndExhaustedTrial() {
        UserInfoVO input = new UserInfoVO(); input.setAiSeatStatus(true);
        assertDoesNotThrow(() -> users.savePreference(input));
        verify(infoMapper).update(any(UserInfoDO.class), any());
        verifyNoInteractions(trials, productMapper, custom);
    }
    @Test void commercialSeatStillRejectsAnExhaustedTrial() {
        ReflectionTestUtils.setField(config, "personalMode", false);
        when(productMapper.queryUserValidAllProductType(3L)).thenReturn(Set.of());
        when(trials.canTrial(eq(3L), eq(1), eq(config))).thenReturn(false);
        UserInfoVO input = new UserInfoVO(); input.setAiSeatStatus(true);
        assertThrows(ApplicationException.class, () -> users.savePreference(input));
        verifyNoInteractions(infoMapper);
    }
    @Test void readPersonalSeatPreservesEnabledStatusWithoutTrialCheck() {
        UserInfoDO info = new UserInfoDO(); info.setId(3L); info.setAiSeatStatus(1); info.setPreference("{}");
        when(infoMapper.selectById(3L)).thenReturn(info);
        assertEquals(Boolean.TRUE, users.getUserInfo().getAiSeatStatus());
        verifyNoInteractions(trials, productMapper, custom);
    }
    @Test void newPersonalSeatDefaultsToOffNotAutoEnabled() {
        UserInfoDO info = new UserInfoDO(); info.setId(3L); info.setPreference("{}");
        when(infoMapper.selectById(3L)).thenReturn(info);
        assertEquals(Boolean.FALSE, users.getUserInfo().getAiSeatStatus());
    }
    @Test void preferenceSaveWithoutSeatDoesNotClearSeat() {
        UserInfoVO input = new UserInfoVO(); input.setEmail("local-test@example.invalid");
        doAnswer(invocation -> {
            com.baomidou.mybatisplus.core.conditions.Wrapper<?> wrapper = invocation.getArgument(1);
            assertFalse(wrapper.getSqlSet().contains("ai_seat_status"));
            return 1;
        }).when(infoMapper).update(any(UserInfoDO.class), any());
        users.savePreference(input);
    }
}
