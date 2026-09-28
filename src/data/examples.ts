/**
 * Model fixtures for future Board creation. NOT part of BOARD_LIST and not
 * shown in the consumer UI; Graph Debug lists them to prove the model.
 *
 *   Kathmandu            → canonical Board for the place
 *   Kathmandu Food Hunt  → user_created Board hanging off it
 */
import { makeBoard } from '@/services/boardFactory';
import type { Board } from '@/types/models';
import { card, hero } from './media';

export const EXAMPLE_BOARDS: Board[] = [
  makeBoard({
    id: 'kathmandu',
    type: 'canonical',
    title: 'Kathmandu',
    tagline: 'Temples, trekking gateways and momo at every corner.',
    category: 'travel',
    location: 'kathmandu',
    interests: ['i_travel', 'i_solo', 'i_photo'],
    cover: card('landscape'),
    hero: hero('landscape'),
    memberCount: 0,
    ideaCount: 0,
    activityVerb: 'exploring',
    ownerId: 'chimp',
    createdAt: '2026-09-23',
    memberPreview: [],
    themeId: 'terracotta',
    template: 'standard',
    pulseShape: 'circle',
    editorial: 60,
    identityModes: ['public', 'pseudonymous'],
  }),
  makeBoard({
    id: 'kathmandu-food-hunt',
    type: 'user_created',
    canonicalParentId: 'kathmandu',
    relatedBoardIds: ['kathmandu'],
    title: 'Kathmandu Food Hunt',
    tagline: 'Every momo stall worth the queue.',
    category: 'culture',
    location: 'kathmandu',
    interests: ['i_food', 'i_travel'],
    cover: card('food'),
    hero: hero('food'),
    memberCount: 1,
    ideaCount: 0,
    activityVerb: 'tasting',
    ownerId: 'u_wollymc',
    createdAt: '2026-09-23',
    memberPreview: ['u_wollymc'],
    themeId: 'ember',
    template: 'standard',
    pulseShape: 'card',
    editorial: 40,
    identityModes: ['public'],
  }),
];
