package com.maple.ai.job.hunting.config.ai;

import cn.hutool.json.JSONUtil;
import com.alibaba.fastjson.JSONObject;
import com.maple.ai.job.hunting.common.ai.AIConfigHelper;
import com.maple.ai.job.hunting.common.ai.CompletionPathOpenAiApi;
import com.maple.ai.job.hunting.consts.AIPromptStrConstant;
import com.maple.ai.job.hunting.frame.exp.ApplicationException;
import org.springframework.core.env.Environment;
import com.maple.smart.config.core.annotation.JsonValue;
import com.maple.smart.config.core.listener.ConfigListener;
import com.maple.smart.config.core.model.ConfigEntity;
import com.maple.smart.config.core.repository.ConfigRepository;
import com.maple.smart.config.core.spring.SmartConfigSpringContext;
import com.maple.smart.config.core.subscription.ConfigSubscription;
import jakarta.annotation.Nonnull;
import jakarta.annotation.Nullable;
import jakarta.annotation.PostConstruct;
import jakarta.annotation.Resource;
import lombok.Getter;
import lombok.Setter;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.collections4.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.jetbrains.annotations.NotNull;
import org.springframework.ai.openai.OpenAiChatClient;
import org.springframework.ai.openai.OpenAiChatOptions;
import org.springframework.ai.openai.api.OpenAiApi;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.stereotype.Component;

import java.util.*;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.Collectors;

/**
 * @author maple
 * Created Date: 2024/5/8 14:59
 * Description:
 */

@Configuration
public class OpenAIPoolConfig {

    @Slf4j
    @Component
    public static class OpenAIPoolManager implements ConfigListener {

        @Resource
        private AIConfigHelper aiConfigHelper;

        @Resource
        private ConfigRepository configRepository;

        @Resource
        private Environment environment;

        @JsonValue("${openai.pool.config.list:[]}")
        private List<JSONObject> openaiPoolConfigList;

        @Value("${openai.pool.config.auto:true}")
        private Boolean autoConfigPool;

        private final Map<String, OpenAIPoolClient> poolMap = new ConcurrentHashMap<>();

        private final AtomicInteger poolIndex = new AtomicInteger(0);

        private final AtomicReference<OpenAIPoolClient> firstClient = new AtomicReference<>();

        @PostConstruct
        public void init() {
            openaiPoolConfigList = effectiveConfigurations();
            if (CollectionUtils.isEmpty(openaiPoolConfigList) && !Boolean.TRUE.equals(autoConfigPool)) {
                return;
            }
            if (CollectionUtils.isEmpty(openaiPoolConfigList)) {
                List<JSONObject> openaiPoolConfigList = new ArrayList<>();
                Map<String, List<ConfigEntity>> aiConfigGroupMap = configRepository.resolvedPlaceholdersConfigList().stream()
                        .filter(configEntity -> configEntity.getKey().startsWith("spring.ai."))
                        .collect(Collectors.groupingBy(configEntity -> configEntity.getKey().replace("spring.ai.", "").split("\\.")[0]));
                for (Map.Entry<String, List<ConfigEntity>> entry : aiConfigGroupMap.entrySet()) {
                    String name = entry.getKey();
                    List<ConfigEntity> configEntityList = entry.getValue();
                    // 配置项小于3个(baseUrl,apiKey,model)，跳过
                    if (CollectionUtils.isEmpty(configEntityList) || configEntityList.size() < 3) {
                        continue;
                    }
                    JSONObject jsonObject = buildAiConfig(name, configEntityList);
                    openaiPoolConfigList.add(jsonObject);
                }
                this.openaiPoolConfigList = openaiPoolConfigList;
            }
            log.info("openai pool init: {} configured entries", openaiPoolConfigList.size());
            refresh();
        }

        private static @NotNull JSONObject buildAiConfig(String name, List<ConfigEntity> configEntityList) {
            JSONObject jsonObject = new JSONObject();
            jsonObject.put("name", name);
            for (ConfigEntity configEntity : configEntityList) {
                // 去掉前缀 【spring.ai.gemini.api-key =》 api-key】
                String configKey = configEntity.getKey().substring(configEntity.getKey().indexOf(name) + name.length() + 1);
                jsonObject.put(configKey, configEntity.getValue());
            }
            return jsonObject;
        }

        private List<JSONObject> effectiveConfigurations() {
            if (environment != null && environment.getProperty("app.personal-mode", Boolean.class, false)) {
                // Smart Config's JSON placeholder resolver ignores process environment variables.
                // Read local secrets through Spring Environment instead; never log the values.
                JSONObject local = new JSONObject();
                local.put("name", "openai-pool");
                local.put("api-key", environment.getProperty("AI_API_KEY", ""));
                local.put("base-url", environment.getProperty("AI_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1"));
                local.put("completions-path", environment.getProperty("AI_COMPLETIONS_PATH", "/chat/completions"));
                local.put("chat.options.model", environment.getProperty("AI_MODEL", "qwen3-vl-32b-thinking"));
                local.put("chat.options.timeout", environment.getProperty("AI_TIMEOUT_SECONDS", Integer.class, 15));
                JSONObject extra = new JSONObject();
                extra.put("enable_thinking", true);
                extra.put("thinking_budget", environment.getProperty("AI_THINKING_BUDGET", Integer.class, 256));
                local.put("extraBody", extra);
                return List.of(local);
            }
            return openaiPoolConfigList == null ? Collections.emptyList() : openaiPoolConfigList;
        }

        private void refresh() {
            List<JSONObject> configurations = effectiveConfigurations();
            firstClient.compareAndSet(firstClient.get(), null);
            Set<String> oldPoolNameSet = new HashSet<>(poolMap.keySet());
            for (JSONObject jsonObject : configurations) {
                String name = jsonObject.getString("name");
                String apiKey = jsonObject.getString("api-key");
                String baseUrl = jsonObject.getString("base-url");
                JSONObject extraBody = null;
                try {
                    extraBody = jsonObject.getJSONObject("extraBody");
                } catch (Exception e) {
                    log.error("extraBody解析失败 extraBody:{}", jsonObject.getString("extraBody"), e);
                }
                String completionsPath = aiConfigHelper.getAiConfig(jsonObject::getString, "completions-path");
                String model = aiConfigHelper.getAiConfig(jsonObject::getString, "chat.options.model");
                Boolean proxy = aiConfigHelper.getAiConfig(jsonObject::getBoolean, "chat.options.proxy");
                Boolean first = aiConfigHelper.getAiConfig(jsonObject::getBoolean, "chat.options.first");

                if (StringUtils.isBlank(baseUrl) || StringUtils.isBlank(model) || StringUtils.isBlank(apiKey)) {
                    log.warn("openai config is empty name:{}", name);
                    continue;
                }

                OpenAIPoolClient client;
                if (Boolean.TRUE.equals(proxy)) {
                    client = new OpenAIPoolClient(new CompletionPathOpenAiApi(baseUrl, apiKey, completionsPath,
                            aiConfigHelper.buildProxyRestClient()), OpenAiChatOptions.builder().withModel(model).build());
                } else if (jsonObject.getInteger("chat.options.timeout") != null) {
                    int timeout = Math.max(1, Math.min(120, jsonObject.getInteger("chat.options.timeout")));
                    client = new OpenAIPoolClient(new CompletionPathOpenAiApi(baseUrl, apiKey, completionsPath,
                            AIConfigHelper.buildRestClient(timeout), extraBody),
                            OpenAiChatOptions.builder().withModel(model).build());
                } else {
                    client = new OpenAIPoolClient(new CompletionPathOpenAiApi(baseUrl, apiKey, completionsPath, extraBody),
                            OpenAiChatOptions.builder().withModel(model).build());
                }
                client.setName(name);
                if (Boolean.TRUE.equals(first)) {
                    firstClient.set(client);
                }
                oldPoolNameSet.remove(name);
                poolMap.put(name, client);
            }
            // 删除配置中没有的client
            oldPoolNameSet.forEach(poolMap::remove);
            log.info("openai pool refresh:{}", JSONUtil.toJsonStr(poolMap.keySet()));
        }

        @Nonnull
        public OpenAIPoolClient getClient() {
            OpenAIPoolClient preferred = firstClient.get();
            if (preferred != null) return preferred;
            List<OpenAIPoolClient> list = poolMap.values().stream().toList();
            if (list.isEmpty()) {
                throw new ApplicationException("未配置可用模型，请检查本地 AI_API_KEY、AI_BASE_URL 和 AI_MODEL");
            }
            return list.get(Math.floorMod(poolIndex.getAndIncrement(), list.size()));
        }

        @Nullable
        @SuppressWarnings("unused")
        public OpenAIPoolClient getClient(String name) {
            return poolMap.get(name);
        }

        public int getPoolSize() {
            if (firstClient.get() != null) {
                return 1;
            }
            return poolMap.size();
        }

        @Override
        public void onChange(Collection<ConfigEntity> changeConfigEntityList) {
            // todo 后期迁移至 SmartConfigListener
            changeConfigEntityList.stream()
                    .filter(configEntity -> "openai.pool.config.list".equals(configEntity.getKey()))
                    .findAny()
                    .ifPresent(x -> SmartConfigSpringContext.getBean(OpenAIPoolManager.class).refresh());

            changeConfigEntityList.stream()
                    .filter(configEntity -> "ai.system.prompt".equals(configEntity.getKey()))
                    .findAny()
                    .ifPresent(configEntity -> {
                        log.info("ai.system.prompt change:{}", configEntity.getValue());
                        AIPromptStrConstant.AI_SEAT_SYSTEM_PROMPT = configEntity.getValue();
                    });

        }

        @Override
        public void setConfigSubscription(ConfigSubscription configSubscription) {
        }
    }

    @Getter
    @Setter
    public static class OpenAIPoolClient extends OpenAiChatClient {

        private String name;

        public OpenAIPoolClient(OpenAiApi openAiApi, OpenAiChatOptions options) {
            super(openAiApi, options);
        }
    }
}
