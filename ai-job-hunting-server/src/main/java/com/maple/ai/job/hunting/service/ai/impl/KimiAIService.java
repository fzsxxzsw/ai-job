package com.maple.ai.job.hunting.service.ai.impl;

import cn.hutool.core.util.IdUtil;
import com.maple.ai.job.hunting.config.ai.KimiAIConfig;
import com.maple.ai.job.hunting.consts.AIPromptStrConstant;
import com.maple.ai.job.hunting.emums.AiFileResolveResultTypeEnum;
import com.maple.ai.job.hunting.frame.exp.ApplicationException;
import com.maple.ai.job.hunting.model.AiFileResolveResult;
import jakarta.annotation.Resource;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.text.PDFTextStripper;
import org.springframework.ai.chat.ChatResponse;
import org.springframework.ai.chat.messages.Message;
import org.springframework.ai.chat.messages.SystemMessage;
import org.springframework.ai.chat.messages.UserMessage;
import org.springframework.ai.chat.prompt.Prompt;
import org.springframework.ai.openai.OpenAiChatClient;
import org.springframework.stereotype.Service;

import java.io.IOException;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;

/**
 * @author maple
 * Created Date: 2024/5/8 14:45
 * Description:
 */

@Slf4j
@Service("kimi")
public class KimiAIService extends OpenAIService {

    @Resource
    private KimiAIConfig.KimiAIChatClient kimiAIChatClient;

    @Override
    protected OpenAiChatClient getClient() {
        return kimiAIChatClient;
    }

    @Override
    public void init() {
        // 简历 PDF 在本机解析，不再上传到 Moonshot，也不需要云端文件清理任务。
        log.info("Kimi file service initialized with local PDF parsing");
    }

    @Override
    public AiFileResolveResult readFile(InputStream inputStream, String ask) {
        String content = extractPdfText(inputStream);
        return AiFileResolveResult.builder()
                .fileId("local-" + IdUtil.fastUUID())
                .resolveResultType(AiFileResolveResultTypeEnum.UNRESOLVED)
                .originalFileContent(content)
                .resolveResult(null)
                .extra(null)
                .build();
    }

    static String extractPdfText(InputStream inputStream) {
        try (PDDocument document = PDDocument.load(inputStream)) {
            String content = new PDFTextStripper().getText(document);
            if (StringUtils.isBlank(content)) {
                throw new ApplicationException("未能从 PDF 提取文本，请确认简历不是纯图片扫描件");
            }
            return content;
        } catch (ApplicationException e) {
            throw e;
        } catch (IOException | RuntimeException e) {
            log.warn("本地解析 PDF 简历失败: {}", e.getMessage());
            throw new ApplicationException("解析 PDF 简历失败，请重新下载简历后重试");
        }
    }

    /**
     * 总结简历
     * 调用ai总结简历，需要消耗token，总token大概2000左右【根据简历文字数量】
     *
     * @param fileContent 文件内容
     * @return {@link String}
     */
    @Deprecated
    private String summarizeResume(String fileContent) {
        List<Message> messageList = new ArrayList<>();
        messageList.add(new SystemMessage(fileContent));
        messageList.add(new UserMessage(AIPromptStrConstant.AI_SEAT_SYSTEM_PROMPT));
        Prompt prompt = new Prompt(messageList);
        ChatResponse chatResponse = kimiAIChatClient.call(prompt);
        return chatResponse.getResult().getOutput().getContent();
    }
}
