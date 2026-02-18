import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './stores/ThemeContext';
import { AuthProvider } from './stores/AuthContext';
import Layout from './components/Layout';
import Home from './pages/Home';
import Verify from './pages/Verify';
import Profile from './pages/Profile';
import Admin from './pages/Admin';

import './assets/styles/index.css';

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            {/* 首页直接显示 Verify 页面 */}
            <Route
              path="/"
              element={
                <Layout>
                  <Verify />
                </Layout>
              }
            />
            {/* 管理员登录页面 */}
            <Route path="/login" element={<Home />} />
            <Route path="/verify" element={<Navigate to="/" replace />} />
            <Route path="/dashboard" element={<Navigate to="/" replace />} />
            <Route path="/recharge" element={<Navigate to="/" replace />} />
            <Route
              path="/profile"
              element={
                <Layout>
                  <Profile />
                </Layout>
              }
            />
            <Route
              path="/admin"
              element={
                <Layout>
                  <Admin />
                </Layout>
              }
            />
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}

export default App;
