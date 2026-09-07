"""Bounded local PDF text extraction, invoked in a disposable subprocess."""

import io
import json
import sys

from pypdf import PdfReader


def extract(data: bytes) -> str:
    if not data.startswith(b"%PDF-") or len(data) > 20 * 1024 * 1024:
        raise ValueError("只接受20MB以内的PDF简历")
    reader = PdfReader(io.BytesIO(data), strict=False)
    if reader.is_encrypted:
        raise ValueError("暂不支持加密PDF，请上传未加密简历")
    if len(reader.pages) > 30:
        raise ValueError("简历页数超过30页")
    result = []
    for page in reader.pages:
        contents = page.get_contents()
        if contents and len(contents.get_data()) > 10_000_000:
            raise ValueError("PDF单页内容过大")
        result.append(page.extract_text() or "")
        if sum(len(x) for x in result) > 100000:
            raise ValueError("简历文本过长")
    text = "\n".join(result).strip()
    if not text:
        raise ValueError("未识别到简历文字，请使用可复制文本的PDF，扫描件需要先转为文字")
    return text


if __name__ == "__main__":
    try:
        text = extract(sys.stdin.buffer.read(20 * 1024 * 1024 + 1))
        print(json.dumps({"text": text}, ensure_ascii=True))
    except Exception:
        print(
            json.dumps(
                {"error": "简历解析失败：请使用20MB以内、30页以内、未加密且可复制文字的PDF"},
                ensure_ascii=True,
            )
        )
        sys.exit(1)
