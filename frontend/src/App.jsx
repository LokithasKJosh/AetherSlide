import { Link, Navigate, Route, Routes } from "react-router-dom";
import ChatPage from "./pages/ChatPage";
import TemplatesPage from "./pages/TemplatesPage";
import HistoryPage from "./pages/HistoryPage";

export default function App() {
  return (
    <div className="app-shell">
      <header className="top-nav">
        <h1>幻智星</h1>
        <nav>
          <Link to="/chat">生成页</Link>
          <Link to="/templates">模板页</Link>
          <Link to="/history">历史页</Link>
        </nav>
      </header>

      <main className="page-body">
        <Routes>
          <Route path="/" element={<Navigate to="/chat" replace />} />
          <Route path="/chat" element={<ChatPage />} />
          <Route path="/templates" element={<TemplatesPage />} />
          <Route path="/history" element={<HistoryPage />} />
        </Routes>
      </main>
    </div>
  );
}
