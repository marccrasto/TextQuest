from paddleocr import PaddleOCR
import sys
import json

def extract_text(img_path):
    ocr = PaddleOCR(
        use_doc_orientation_classify=False,
        use_doc_unwarping=False,
        use_textline_orientation=False
    )

    result = ocr.predict(img_path)

    text_lines = []
    for res in result:
        for line in res["rec_texts"]:
            text_lines.append(line)

    return "\n".join(text_lines)

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(json.dumps({ "error": "Image path missing" }))
        sys.exit(1)

    img_path = sys.argv[1]
    text = extract_text(img_path)

    # Output valid JSON so Node can parse it
    print(json.dumps({ "ocr_text": text }))