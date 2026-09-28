import { Backpack, Camera, Cpu, Heart, Laptop, Leaf, LucideIcon, MapPin, Moon, Music, Palette, PenTool, Plane, Rocket, Shirt, Sparkles, Tag, Utensils } from 'lucide-react-native';

const ICON: Record<string, LucideIcon> = {
  i_travel: Plane,
  i_japan: MapPin,
  i_italy: MapPin,
  i_solo: Backpack,
  i_food: Utensils,
  i_photo: Camera,
  i_art: Palette,
  i_music: Music,
  i_design: PenTool,
  i_creativity: Sparkles,
  i_wellness: Leaf,
  i_style: Shirt,
  i_vintage: Tag,
  i_startups: Rocket,
  i_ai: Cpu,
  i_tech: Laptop,
  i_nightlife: Moon,
  i_dating: Heart,
};

export function InterestIcon({ id, size = 13, color }: { id: string; size?: number; color: string }) {
  const I = ICON[id] ?? Sparkles;
  return <I size={size} color={color} />;
}
