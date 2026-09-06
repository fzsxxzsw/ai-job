package com.maple.ai.job.hunting.controller;

import com.fasterxml.jackson.databind.JsonNode;
import com.maple.ai.job.hunting.model.common.Response;
import com.maple.ai.job.hunting.service.biz.RejectionGateway;
import com.maple.ai.job.hunting.service.biz.RejectionGateway.Operation;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.web.bind.annotation.*;
import java.io.IOException;

/** All requests still pass the existing LoginFilter; client identity headers are never forwarded. */
@RestController
@RequestMapping("/api/job/ai")
public class RejectionGatewayController {
    private final RejectionGateway gateway;
    public RejectionGatewayController(RejectionGateway gateway) { this.gateway = gateway; }

    private Response<JsonNode> dispatch(Operation operation, Long id, HttpServletRequest request) throws IOException {
        if (request.getQueryString() != null) return Response.error(422, "此接口不接受查询参数");
        return gateway.forward(operation, id, request.getInputStream().readNBytes(256001));
    }

    @PostMapping(value="/applications/snapshot", consumes="application/json")
    public Response<JsonNode> snapshot(HttpServletRequest r) throws IOException { return dispatch(Operation.SNAPSHOT,null,r); }
    @PostMapping(value="/rejections/analyze", consumes="application/json")
    public Response<JsonNode> analyze(HttpServletRequest r) throws IOException { return dispatch(Operation.ANALYZE,null,r); }
    @PostMapping(value="/rejections/{id}/feedback", consumes="application/json")
    public Response<JsonNode> feedback(@PathVariable Long id, HttpServletRequest r) throws IOException { return dispatch(Operation.FEEDBACK,id,r); }
    @GetMapping("/rejections/{id}")
    public Response<JsonNode> report(@PathVariable Long id, HttpServletRequest r) throws IOException { return dispatch(Operation.REPORT,id,r); }
    @GetMapping("/rejections/summary")
    public Response<JsonNode> summary(HttpServletRequest r) throws IOException { return dispatch(Operation.SUMMARY,null,r); }
    @GetMapping("/rejections/history")
    public Response<JsonNode> history(HttpServletRequest r) throws IOException { return dispatch(Operation.HISTORY,null,r); }
    @GetMapping("/rejections/status")
    public Response<JsonNode> status(HttpServletRequest r) throws IOException { return dispatch(Operation.STATUS,null,r); }
}
