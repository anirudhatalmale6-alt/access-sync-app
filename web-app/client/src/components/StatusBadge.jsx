import React from 'react';

export default function StatusBadge({ status }) {
  const styles = {
    idle: 'badge-success',
    running: 'badge-warning',
    error: 'badge-error',
    syncing: 'badge-info'
  };

  const labels = {
    idle: 'Idle',
    running: 'Running',
    error: 'Error',
    syncing: 'Syncing'
  };

  const cls = styles[status] || 'badge-info';
  const label = labels[status] || status || 'Unknown';

  return (
    <span className={cls}>
      <span className={`w-2 h-2 rounded-full mr-1.5 ${
        status === 'idle' ? 'bg-green-400' :
        status === 'running' ? 'bg-yellow-400 animate-pulse' :
        status === 'error' ? 'bg-red-400' : 'bg-blue-400'
      }`} />
      {label}
    </span>
  );
}
