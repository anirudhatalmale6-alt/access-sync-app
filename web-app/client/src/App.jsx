import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Dashboard from './pages/Dashboard';
import TablesList from './pages/TablesList';
import TableDetail from './pages/TableDetail';
import SyncMonitor from './pages/SyncMonitor';
import Settings from './pages/Settings';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="tables" element={<TablesList />} />
        <Route path="tables/:name" element={<TableDetail />} />
        <Route path="sync" element={<SyncMonitor />} />
        <Route path="settings" element={<Settings />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
