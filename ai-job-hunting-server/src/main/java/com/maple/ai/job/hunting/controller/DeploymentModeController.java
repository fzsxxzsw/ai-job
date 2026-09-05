package com.maple.ai.job.hunting.controller;

import com.maple.ai.job.hunting.config.AppBizConfig;
import com.maple.ai.job.hunting.model.common.Response;
import jakarta.annotation.Resource;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import java.util.Map;

/** Authenticated, read-only status for local deployment verification. */
@RestController
public class DeploymentModeController {
    @Resource
    private AppBizConfig appBizConfig;

    @GetMapping("/api/deployment/mode")
    public Response<Map<String, Boolean>> mode() {
        return Response.success(Map.of("personalMode", appBizConfig.isPersonalMode(),
                "salesEnabled", !appBizConfig.isPersonalMode()));
    }
}
