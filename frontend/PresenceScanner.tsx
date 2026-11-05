// ============================================================================
// KUMA Module: Pointage — Frontend Scanner Autonome
// ============================================================================
import React from 'react';
import { PresenceService } from './presence.service';

interface Props {
    lang?: 'fr' | 'en';
    apiBase?: string;
}

export default function PresenceScanner({ lang = 'fr', apiBase }: Props) {
    const [loading, setLoading] = React.useState(false);
    const [message, setMessage] = React.useState<string | null>(null);

    const handleScan = async () => {
        const studentId = prompt(lang === 'fr' ? 'ID Élève:' : 'Student ID:');
        const classId = prompt(lang === 'fr' ? 'ID Classe:' : 'Class ID:');
        const sessionType = lang === 'fr' ? 'entry' : 'entry';
        
        if (!studentId || !classId) return;

        setLoading(true);
        setMessage(null);
        
        try {
            const res = await PresenceService.scan({
                studentId,
                classId,
                sessionType: 'entry' as any,
                method: 'mobile',
                apiBase
            });
            setMessage(lang === 'fr' ? 'Pointage enregistré' : 'Scan recorded');
        } catch (e) {
            setMessage(lang === 'fr' ? 'Erreur de pointage' : 'Scan failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="p-6 bg-white rounded-lg shadow-md">
            <h2 className="text-xl font-bold mb-4">
                {lang === 'fr' ? 'Pointage Élèves' : 'Student Check-in'}
            </h2>
            
            {message && (
                <div className="mb-4 p-3 rounded bg-green-50 text-green-700">
                    {message}
                </div>
            )}

            <button 
                onClick={handleScan}
                disabled={loading}
                className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700"
            >
                {loading 
                    ? (lang === 'fr' ? 'Enregistrement...' : 'Recording...')
                    : (lang === 'fr' ? 'Scanner Pointage' : 'Scan Check-in')
                }
            </button>
        </div>
    );
}