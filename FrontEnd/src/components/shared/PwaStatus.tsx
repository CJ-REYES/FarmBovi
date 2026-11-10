import { Wifi, WifiOff } from 'lucide-react';
import { useState, useEffect } from 'react';

export default function PwaStatus() {
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const handleOnline = () => setIsOnline(true);
    const handleOffline = () => setIsOnline(false);

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  return (
    <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-source font-semibold ${isOnline ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
      {isOnline ? <Wifi size={14} /> : <WifiOff size={14} />}
      <span className="hidden sm:inline">{isOnline ? 'En línea' : 'Sin conexión'}</span>
    </div>
  );
}
