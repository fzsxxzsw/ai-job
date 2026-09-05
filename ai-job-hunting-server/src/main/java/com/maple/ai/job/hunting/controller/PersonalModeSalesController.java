package com.maple.ai.job.hunting.controller;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import java.util.Map;

/** No payment client or order service is reachable in personal mode. */
@RestController
@ConditionalOnProperty(name = "app.personal-mode", havingValue = "true")
public class PersonalModeSalesController {
    @RequestMapping({"/api/pay", "/api/pay/**", "/api/user/invites", "/api/user/invites/**"})
    public ResponseEntity<Map<String, Object>> disabled() {
        return ResponseEntity.status(410).body(Map.of("code", 410,
                "message", "个人自用模式已关闭售卖、支付和邀请兑换，无需购买坐席"));
    }
}
