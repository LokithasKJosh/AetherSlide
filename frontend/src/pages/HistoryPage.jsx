import { useEffect, useState } from "react";
import { fetchHistory } from "../api";

export default function HistoryPage() {
  const [items, setItems] = useState([]);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchHistory()
      .then((res) => setItems(res.items || []))
      .catch((err) => setError(String(err.message || err)));
  }, []);

  return (
    <section className="page">
      <h2>已生成 PPT 浏览页</h2>
      {error && <p className="error">错误：{error}</p>}

      <div className="panel">
        {items.length === 0 && <p className="tip">当前暂无历史文件。</p>}
        {items.length > 0 && (
          <table className="history-table">
            <thead>
              <tr>
                <th>文件名</th>
                <th>大小 (bytes)</th>
                <th>更新时间</th>
                <th>下载</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.file_name}>
                  <td>{item.file_name}</td>
                  <td>{item.size_bytes}</td>
                  <td>{item.updated_at}</td>
                  <td>
                    <a href={item.download_url}>下载</a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
