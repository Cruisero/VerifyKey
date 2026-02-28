import { useState, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { ThemeProvider } from './stores/ThemeContext';
import { LanguageProvider } from './stores/LanguageContext';
import { AuthProvider } from './stores/AuthContext';
import Layout from './components/Layout';
import Home from './pages/Home';
import Verify from './pages/Verify';
import Profile from './pages/Profile';
import Admin from './pages/Admin';
import ApiDocs from './pages/ApiDocs';
import Maintenance from './pages/Maintenance';

import './assets/styles/index.css';

const API_BASE = import.meta.env.VITE_API_URL || (import.meta.env.DEV ? 'http://localhost:3002' : '');

function App() {
  const [maintenance, setMaintenance] = useState({ enabled: false, message: '', estimatedEnd: null });
  const [maintenanceLoaded, setMaintenanceLoaded] = useState(false);

  // Check maintenance status on mount
  useEffect(() => {
    const checkMaintenance = async () => {
      try {
        const res = await fetch(`${API_BASE}/api/maintenance`);
        if (res.ok) {
          const data = await res.json();
          setMaintenance(data);
        }
      } catch (e) {
        console.warn('Failed to check maintenance status:', e);
      } finally {
        setMaintenanceLoaded(true);
      }
    };
    checkMaintenance();
    // Re-check every 60 seconds
    const interval = setInterval(checkMaintenance, 60000);
    return () => clearInterval(interval);
  }, []);

  // Don't render until we know maintenance status
  if (!maintenanceLoaded) return null;

  return (
    <LanguageProvider>
      <ThemeProvider>
        <AuthProvider>
          <BrowserRouter>
            <Routes>
              {maintenance.enabled ? (
                <>
                  {/* During maintenance: only admin + login routes work */}
                  <Route path="/login" element={<Home />} />
                  <Route
                    path="/admin"
                    element={
                      <Layout>
                        <Admin />
                      </Layout>
                    }
                  />
                  {/* Everything else shows maintenance page */}
                  <Route path="*" element={
                    <Maintenance
                      message={maintenance.message}
                      estimatedEnd={maintenance.estimatedEnd}
                    />
                  } />
                </>
              ) : (
                <>
                  {/* Normal routes */}
                  <Route
                    path="/"
                    element={
                      <Layout>
                        <Verify />
                      </Layout>
                    }
                  />
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
                  <Route
                    path="/api-docs"
                    element={
                      <Layout>
                        <ApiDocs />
                      </Layout>
                    }
                  />
                </>
              )}
            </Routes>
          </BrowserRouter>
        </AuthProvider>
      </ThemeProvider>
    </LanguageProvider>
  );
}

export default App;
