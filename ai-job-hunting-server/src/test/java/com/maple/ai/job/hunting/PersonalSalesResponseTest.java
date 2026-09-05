package com.maple.ai.job.hunting;

import com.maple.ai.job.hunting.controller.PersonalModeSalesController;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import static org.junit.jupiter.api.Assertions.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class PersonalSalesResponseTest {
    @Test void disabledSalesReturnsAnExplicitGoneResponseNotAServerError() throws Exception {
        var mvc = MockMvcBuilders.standaloneSetup(new PersonalModeSalesController()).build();
        mvc.perform(get("/api/pay/getQr")).andExpect(status().isGone()).andExpect(jsonPath("$.code").value(410));
        mvc.perform(post("/api/pay/generate/order/group")).andExpect(status().isGone());
        mvc.perform(post("/api/user/invites/exchange/products")).andExpect(status().isGone());
    }
    @Test void explanatoryRoutesExistOnlyInPersonalMode() {
        var runner = new ApplicationContextRunner().withUserConfiguration(PersonalModeSalesController.class);
        runner.withPropertyValues("app.personal-mode=true").run(context ->
                assertEquals(1, context.getBeansOfType(PersonalModeSalesController.class).size()));
        runner.withPropertyValues("app.personal-mode=false").run(context ->
                assertTrue(context.getBeansOfType(PersonalModeSalesController.class).isEmpty()));
    }
}
