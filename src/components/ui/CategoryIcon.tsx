import { Landmark, LucideIcon, Moon, Plane, Shirt, Users } from 'lucide-react-native';

import type { CategoryId } from '@/types/models';

export const CATEGORY_ICON: Record<CategoryId, LucideIcon> = {
  travel: Plane,
  culture: Landmark,
  style: Shirt,
  founders: Users,
  afterDark: Moon,
};

export function CategoryIcon({ id, size = 16, color }: { id: CategoryId; size?: number; color: string }) {
  const I = CATEGORY_ICON[id];
  const filled = id === 'travel' || id === 'afterDark';
  return <I size={size} color={color} fill={filled ? color : 'transparent'} strokeWidth={2} />;
}
