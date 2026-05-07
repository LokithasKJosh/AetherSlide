import { useEffect, useRef, useState } from "react";
import { fetchGeneratedPreview, fetchTemplates, streamChat, uploadReferenceFile } from "../api";
import ParticleTextCanvas from "../components/ParticleTextCanvas";
import CustomSelect from "../components/CustomSelect";

function emptyAssistantMessage() {
  return { role: "assistant", content: "" };
}

export default function ChatPage() {
  const [messages, setMessages] = useState([]);
  const [userInput, setUserInput] = useState("");
  const [fileMeta, setFileMeta] = useState(null);
  const [fileId, setFileId] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);
  const [pptDownloadUrl, setPptDownloadUrl] = useState("");
  const [previewImages, setPreviewImages] = useState([]);
  const [activePreviewIndex, setActivePreviewIndex] = useState(0);
  const [templates, setTemplates] = useState([]);
  const [templateName, setTemplateName] = useState("");
  const [error, setError] = useState("");
  const previewWheelLockRef = useRef(0);

  const templateOptions = [
    { label: "默认模板", value: "" },
    ...templates.map((item) => ({ label: item.name, value: item.template_file })),
  ];

  useEffect(() => {
    fetchTemplates()
      .then((res) => setTemplates(res.items || []))
      .catch((err) => setError(String(err.message || err)));
  }, []);

  async function handleFileUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    try {
      const result = await uploadReferenceFile(file);
      setFileMeta(result);
      setFileId(result.file_id);
    } catch (err) {
      setError(String(err.message || err));
    }
  }

  function extractPptFileName(donePayload) {
    if (donePayload?.ppt_file) {
      return donePayload.ppt_file;
    }

    const downloadUrl = donePayload?.download_url || "";
    if (!downloadUrl) {
      return "";
    }

    const name = downloadUrl.split("/").pop() || "";
    try {
      return decodeURIComponent(name);
    } catch {
      return name;
    }
  }

  async function loadPreviewImages(pptFileName, fallbackImages = []) {
    const directImages = Array.isArray(fallbackImages) ? fallbackImages.filter(Boolean) : [];
    if (directImages.length) {
      setPreviewImages(directImages);
      setActivePreviewIndex(0);
      return;
    }

    if (!pptFileName) {
      setPreviewImages([]);
      setActivePreviewIndex(0);
      return;
    }

    try {
      const res = await fetchGeneratedPreview(pptFileName);
      const images = (res.items || []).map((item) => item.image_url).filter(Boolean);
      setPreviewImages(images);
      setActivePreviewIndex(0);
    } catch (err) {
      setPreviewImages([]);
      setActivePreviewIndex(0);
      setError(String(err.message || err));
    }
  }

  function handlePreviewWheel(event) {
    if (!previewImages.length) {
      return;
    }

    event.preventDefault();
    const now = Date.now();
    if (now - previewWheelLockRef.current < 120) {
      return;
    }
    previewWheelLockRef.current = now;

    const step = event.deltaY > 0 ? 1 : -1;
    setActivePreviewIndex((prev) => {
      const next = prev + step;
      if (next < 0) return 0;
      if (next >= previewImages.length) return previewImages.length - 1;
      return next;
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();
    if (!userInput.trim() || isGenerating) return;

    setIsGenerating(true);
    setError("");
    setPptDownloadUrl("");
    setPreviewImages([]);
    setActivePreviewIndex(0);

    setMessages((prev) => [...prev, { role: "user", content: userInput.trim() }, emptyAssistantMessage()]);

    const payload = {
      user_input: userInput.trim(),
      file_id: fileId || null,
      template_name: templateName || null,
    };
    setUserInput("");

    try {
      await streamChat(payload, (eventType, data) => {
        if (eventType === "token") {
          const text = data.text || "";
          setMessages((prev) => {
            const next = [...prev];
            for (let i = next.length - 1; i >= 0; i -= 1) {
              if (next[i].role === "assistant") {
                next[i] = { ...next[i], content: `${next[i].content}${text}` };
                break;
              }
            }
            return next;
          });
          return;
        }

        if (eventType === "done") {
          setPptDownloadUrl(data.download_url || "");
          const pptFileName = extractPptFileName(data);
          void loadPreviewImages(pptFileName, data.preview_images || []);
          return;
        }

        if (eventType === "error") {
          setError(data.message || "Unknown error");
        }
      });
    } catch (err) {
      setError(String(err.message || err));
    } finally {
      setIsGenerating(false);
    }
  }

  return (
    <section className="chat-page">
      {isGenerating && (
        <video className="generate-bg-video" autoPlay muted loop playsInline>
          <source src="/assets/pulse.mp4" type="video/mp4" />
        </video>
      )}

      <div className="chat-layout">
        <aside className="chat-left">
          <div className="glass-card">
            <h2 className="section-title">模板与资料</h2>

            <div className="field-block">
              <label>选择模板</label>
              <CustomSelect options={templateOptions} value={templateName} onChange={setTemplateName} />
            </div>

            <div className="field-block">
              <label htmlFor="doc-upload">上传参考文件（txt/docx/pdf）</label>
              <div className="field-outline file-outline">
                <input id="doc-upload" className="file-input" type="file" accept=".txt,.docx,.pdf" onChange={handleFileUpload} />
              </div>
            </div>

            {fileMeta && (
              <p className="meta-pill">
                已上传：{fileMeta.filename}（{fileMeta.char_count} 字符）
              </p>
            )}
          </div>

          <form onSubmit={handleSubmit} className="glass-card prompt-card">
            <h2 className="section-title">创建演示文稿</h2>
            <label htmlFor="prompt">输入你的要求</label>
            <textarea
              id="prompt"
              rows={9}
              value={userInput}
              onChange={(event) => setUserInput(event.target.value)}
              placeholder="例如：请生成 8 页，风格正式，面向管理层汇报。"
            />
            <button className="primary-action" type="submit" disabled={isGenerating || !userInput.trim()}>
              {isGenerating ? "生成中..." : "开始生成"}
            </button>
          </form>

          {error && <p className="error">错误：{error}</p>}
        </aside>

        <section className="chat-center">
          <div className="center-visual">
            <ParticleTextCanvas className="center-particle-canvas" text="壹珈智晟" />
            {isGenerating && <p className="status-chip">AI 正在生成内容...</p>}
          </div>
        </section>

        <aside className="chat-right">
          <div className="glass-card preview-card">
            <h2 className="section-title">PPT 预览</h2>
            <div className="preview-box">
              {pptDownloadUrl ? (
                <div className="preview-ready">
                  <div className="preview-scroll-view" onWheel={handlePreviewWheel}>
                    {previewImages.length ? (
                      <img
                        key={previewImages[activePreviewIndex]}
                        className="preview-slide-image"
                        src={previewImages[activePreviewIndex]}
                        alt={`Slide ${activePreviewIndex + 1}`}
                        draggable={false}
                      />
                    ) : (
                      <p className="tip">正在加载预览...</p>
                    )}
                  </div>
                  <div className="preview-meta-row">
                    <span className="preview-page-indicator">
                      {previewImages.length ? `${activePreviewIndex + 1} / ${previewImages.length}` : "0 / 0"}
                    </span>
                    <span className="preview-wheel-tip">滚轮翻页</span>
                  </div>
                  <a className="download-btn" href={pptDownloadUrl}>
                    下载生成的 PPT
                  </a>
                </div>
              ) : (
                <p className="tip">生成完成后，这里展示预览与下载入口。</p>
              )}
            </div>
          </div>

          <div className="glass-card stream-card">
            <h3>生成过程</h3>
            <div className="chat-box">
              {messages.length === 0 && <p className="tip">等待输入...</p>}
              {messages.map((msg, idx) => (
                <div key={idx} className={`message ${msg.role}`}>
                  <strong>{msg.role === "user" ? "用户" : "AI"}：</strong>
                  <span>{msg.content}</span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </section>
  );
}
