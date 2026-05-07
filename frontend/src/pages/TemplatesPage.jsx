import { useEffect, useState } from "react";
import { fetchTemplates, uploadTemplate } from "../api";

export default function TemplatesPage() {
  const [templates, setTemplates] = useState([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function reloadTemplates() {
    const res = await fetchTemplates();
    setTemplates(res.items || []);
  }

  useEffect(() => {
    reloadTemplates().catch((err) => setError(String(err.message || err)));
  }, []);

  async function handleTemplateUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setError("");
    setMessage("");
    try {
      const result = await uploadTemplate(file);
      setMessage(result.message || "模板上传成功。");
      await reloadTemplates();
    } catch (err) {
      setError(String(err.message || err));
    }
  }

  return (
    <section className="page">
      <h2>模板浏览页</h2>
      <div className="panel">
        <div className="inline-row">
          <img src="/assets/template-placeholder.png" alt="template" width="20" height="20" />
          <label htmlFor="template-upload">上传自定义模板</label>
          <input id="template-upload" type="file" accept=".pptx,.potx" onChange={handleTemplateUpload} />
        </div>
        {message && <p className="tip">{message}</p>}
        {error && <p className="error">错误：{error}</p>}
      </div>

      <div className="template-grid">
        {templates.length === 0 && <p className="tip">当前无预设模板。</p>}
        {templates.map((item) => (
          <article key={item.template_file} className="template-card">
            {item.preview_unsupported ? (
              <div className="template-unsupported-preview">{item.preview_message || "格式不支持预览"}</div>
            ) : (
              <img src={item.thumbnail_url} alt={item.name} />
            )}
            <h3>{item.name}</h3>
            <p className="tip">类型：{item.template_type || "本地模板"}</p>
            {item.download_url && <a href={item.download_url}>下载模板文件</a>}
          </article>
        ))}
      </div>
    </section>
  );
}
