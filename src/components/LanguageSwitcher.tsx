import { useLanguage } from '@/contexts/LanguageContext';
import { Button } from '@/components/ui/button';
import { Globe } from 'lucide-react';

export default function LanguageSwitcher() {
  const { language, setLanguage } = useLanguage();

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={() => setLanguage(language === 'fr' ? 'en' : 'fr')}
      className="flex items-center gap-2"
    >
      <Globe className="h-4 w-4" />
      <span className="font-medium">{language === 'fr' ? 'FR' : 'EN'}</span>
    </Button>
  );
}