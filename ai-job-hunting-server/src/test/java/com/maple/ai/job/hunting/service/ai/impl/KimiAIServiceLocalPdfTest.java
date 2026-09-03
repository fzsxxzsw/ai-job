package com.maple.ai.job.hunting.service.ai.impl;

import com.maple.ai.job.hunting.frame.exp.ApplicationException;
import com.maple.ai.job.hunting.model.AiFileResolveResult;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.PDPage;
import org.apache.pdfbox.pdmodel.PDPageContentStream;
import org.apache.pdfbox.pdmodel.font.PDType1Font;
import org.junit.jupiter.api.Test;

import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

class KimiAIServiceLocalPdfTest {

    private static final String RESUME_TEXT = "Resume test@example.com 13800138000";

    @Test
    void readFileExtractsDownloadedPdfLocally() throws IOException {
        KimiAIService service = new KimiAIService();

        AiFileResolveResult result = service.readFile(
                new ByteArrayInputStream(createPdf(RESUME_TEXT)),
                "ignored"
        );

        assertTrue(result.getFileId().startsWith("local-"));
        assertTrue(result.getOriginalFileContent().contains(RESUME_TEXT));
    }

    @Test
    void extractPdfTextRejectsBlankPdf() throws IOException {
        ApplicationException exception = assertThrows(
                ApplicationException.class,
                () -> KimiAIService.extractPdfText(
                        new ByteArrayInputStream(createPdf(null))
                )
        );

        assertEquals(
                "未能从 PDF 提取文本，请确认简历不是纯图片扫描件",
                exception.getMessage()
        );
    }

    @Test
    void extractPdfTextRejectsInvalidPdfWithSafeMessage() {
        ApplicationException exception = assertThrows(
                ApplicationException.class,
                () -> KimiAIService.extractPdfText(
                        new ByteArrayInputStream(
                                "not-a-pdf".getBytes(StandardCharsets.UTF_8)
                        )
                )
        );

        assertEquals(
                "解析 PDF 简历失败，请重新下载简历后重试",
                exception.getMessage()
        );
    }

    private static byte[] createPdf(String text) throws IOException {
        try (PDDocument document = new PDDocument();
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            PDPage page = new PDPage();
            document.addPage(page);

            if (text != null) {
                writeText(document, page, text);
            }
            document.save(output);
            return output.toByteArray();
        }
    }

    private static void writeText(
            PDDocument document,
            PDPage page,
            String text
    ) throws IOException {
        try (PDPageContentStream content = new PDPageContentStream(document, page)) {
            content.beginText();
            content.setFont(PDType1Font.HELVETICA, 12);
            content.newLineAtOffset(72, 720);
            content.showText(text);
            content.endText();
        }
    }
}
