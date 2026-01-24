import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './stores/ThemeContext';
import { AuthProvider } from './stores/AuthContext';
import Layout from './components/Layout';
import Home from './pages/Home';
import Verify from './pages/Verify';
import Recharge from './pages/Recharge';
import Profile from './pages/Profile';
import Admin from './pages/Admin';

import './assets/styles/index.css';

function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/dashboard" element={<Navigate to="/verify" replace />} />
            <Route
              path="/verify"
              element={
                <Layout>
                  <Verify />
                </Layout>
              }
            />
            <Route
              path="/recharge"
              element={
                <Layout>
                  <Recharge />
                </Layout>
              }
            />
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
