// Event templates (v1.41.0): the Templates page, "Save as template", and a
// briefing per template. Rules: lib/eventTemplates.ts. Everything here is for
// the server's event creators (assertEventCreator).
//
//   GET    /:guildId/event-templates                 the new-event form's list
//   GET    /:guildId/event-templates/all             the Templates page
//   POST   /:guildId/event-templates                 create (optionally from an event)
//   POST   /:guildId/event-templates/from-event      Repeat (before the form opens)
//   GET    /:guildId/event-templates/:id             one template
//   PUT    /:guildId/event-templates/:id             edit
//   DELETE /:guildId/event-templates/:id             remove (soft: isActive = false)
//   GET    /:guildId/event-templates/:id/briefing    its briefing, for the editor
//   PUT    /:guildId/event-templates/:id/briefing    save it (optionally from an event's briefing)
//   DELETE /:guildId/event-templates/:id/briefing    remove it

import { Router, type Request, type Response } from 'express';
import {
  parseBriefing,
  remapBriefingRoles,
  safeImageUrl,
  sanitizeBriefing,
  serverLabel,
  type ApiResponse,
  type BriefingLogo,
  type EventTemplateBriefingDto,
  type EventTemplateDto,
  type UpsertEventTemplateBody,
} from '@dem/shared';
import { requireAuth } from '../middleware/requireAuth.js';
import { prisma } from '../../lib/prisma.js';
import { assertEventCreator } from '../../lib/assertEventCreator.js';
import { ValidationError, requireStr, optStr, optStrArr } from '../../lib/validate.js';
import { SIX_MONTHS_MS, cleanRoles, parseRoles, templateDto } from '../../lib/eventTemplates.js';

export const eventTemplatesRouter = Router();

const fail = (res: Response, status: number, error: string) =>
  res.status(status).json({ success: false, error } satisfies ApiResponse);
const params = (req: Request) => req.params as { guildId: string; id?: string };

/** The server's own id in our database, if the person may manage its templates. */
async function hostFor(req: Request, res: Response): Promise<{ id: string; guildId: string } | null> {
  const { guildId } = params(req);
  if (!(await assertEventCreator(req, guildId))) {
    fail(res, 403, 'Forbidden');
    return null;
  }
  const guild = await prisma.guild.findUnique({ where: { guildId }, select: { id: true, guildId: true } });
  if (!guild) {
    fail(res, 404, 'Server not found');
    return null;
  }
  return guild;
}

async function findTemplate(hostDbId: string, id: string | undefined) {
  if (!id) return null;
  return prisma.eventTemplate.findFirst({
    where: { id, guildId: hostDbId, isActive: true },
    include: { uses: { select: { usedAt: true } } },
  });
}

/** Body → the columns a template stores. Throws ValidationError. */
function cleanBody(body: UpsertEventTemplateBody) {
  const name = requireStr(typeof body.name === 'string' ? body.name.trim() : body.name, 'name', 200);
  const description = optStr(body.description ?? undefined, 'description', 2000);
  const musterPoint = optStr(body.musterPoint ?? undefined, 'musterPoint', 300);
  if (body.imageUrl && !safeImageUrl(body.imageUrl))
    throw new ValidationError("imageUrl must be one of the server's images or an https link");
  const vcNames = body.vcNames === undefined ? [] : (optStrArr(body.vcNames, 'vcNames', 10, 100) ?? []);
  const d = body.defaultDuration;
  if (d !== undefined && d !== null && !(Number.isInteger(d) && d >= 5 && d <= 7 * 24 * 60))
    throw new ValidationError('defaultDuration must be between 5 minutes and 7 days');
  return {
    name,
    description: description?.trim() || null,
    musterPoint: musterPoint?.trim() || null,
    imageUrl: body.imageUrl ? safeImageUrl(body.imageUrl) : null,
    roles: JSON.stringify(cleanRoles(body.roles)),
    vcNames: JSON.stringify(vcNames.map((v) => v.trim()).filter(Boolean)),
    briefingChannel: !!body.briefingChannel,
    defaultDuration: d ?? null,
  };
}

async function userIds(req: Request) {
  return prisma.user.findUniqueOrThrow({ where: { id: req.session.userId! }, select: { id: true, discordId: true } });
}

// ── Lists ────────────────────────────────────────────────────────────────────

// The new-event form: every curated template, plus Repeat's five most used of
// the last six months.
eventTemplatesRouter.get('/:guildId/event-templates', requireAuth, async (req, res) => {
  const host = await hostFor(req, res);
  if (!host) return;
  const all = await prisma.eventTemplate.findMany({
    where: { guildId: host.id, isActive: true },
    include: { uses: { select: { usedAt: true } } },
  });
  const dtos = all.map((t) => templateDto(t, host.guildId, t.uses));
  const curated = dtos.filter((t) => t.curated);
  const repeat = dtos
    .filter((t) => !t.curated && t.useCount > 0)
    .sort((a, b) => b.useCount - a.useCount)
    .slice(0, 5);
  const list = [...curated, ...repeat].sort((a, b) => b.useCount - a.useCount || a.name.localeCompare(b.name));
  res.json({ success: true, data: list } satisfies ApiResponse<EventTemplateDto[]>);
});

// The Templates page: everything active, curated first, then by last use.
eventTemplatesRouter.get('/:guildId/event-templates/all', requireAuth, async (req, res) => {
  const host = await hostFor(req, res);
  if (!host) return;
  const all = await prisma.eventTemplate.findMany({
    where: { guildId: host.id, isActive: true },
    include: { uses: { select: { usedAt: true } } },
  });
  const list = all
    .map((t) => templateDto(t, host.guildId, t.uses))
    // Repeat's own templates nobody has used in six months are clutter
    .filter((t) => t.curated || (t.lastUsedAt && Date.now() - new Date(t.lastUsedAt).getTime() < SIX_MONTHS_MS))
    .sort(
      (a, b) =>
        Number(b.curated) - Number(a.curated) ||
        (b.lastUsedAt ?? '').localeCompare(a.lastUsedAt ?? '') ||
        a.name.localeCompare(b.name),
    );
  res.json({ success: true, data: list } satisfies ApiResponse<EventTemplateDto[]>);
});

// ── Create / Repeat ──────────────────────────────────────────────────────────

eventTemplatesRouter.post('/:guildId/event-templates', requireAuth, async (req, res) => {
  const host = await hostFor(req, res);
  if (!host) return;
  const body = (req.body ?? {}) as UpsertEventTemplateBody;
  try {
    // "Save as template": start from the event, let the body override.
    let briefing: string | null = null;
    let merged: UpsertEventTemplateBody = body;
    if (body.fromEventId) {
      const ev = await prisma.event.findFirst({
        where: { id: body.fromEventId, guildId: host.guildId },
        include: { briefing: true },
      });
      if (!ev) {
        fail(res, 404, 'Event not found');
        return;
      }
      merged = {
        name: body.name ?? ev.name,
        description: body.description !== undefined ? body.description : ev.description,
        musterPoint: body.musterPoint !== undefined ? body.musterPoint : ev.musterPoint,
        imageUrl: body.imageUrl !== undefined ? body.imageUrl : ev.imageUrl,
        roles: body.roles ?? parseRoles(ev.roles),
        vcNames: body.vcNames ?? (JSON.parse(ev.vcNames || '[]') as string[]),
        briefingChannel: body.briefingChannel ?? ev.briefingChannel,
        defaultDuration:
          body.defaultDuration !== undefined
            ? body.defaultDuration
            : ev.endTime
              ? Math.round((ev.endTime.getTime() - ev.startTime.getTime()) / 60_000)
              : null,
      };
      if (ev.briefing) briefing = JSON.stringify(parseBriefing(ev.briefing.content));
    }
    const data = cleanBody(merged);
    if (data.defaultDuration !== null && (data.defaultDuration < 5 || data.defaultDuration > 7 * 24 * 60))
      data.defaultDuration = null;
    const me = await userIds(req);
    const t = await prisma.eventTemplate.create({
      data: {
        ...data,
        guildId: host.id,
        createdById: me.id,
        curated: true,
        briefing,
        briefingUpdatedAt: briefing ? new Date() : null,
      },
      include: { uses: { select: { usedAt: true } } },
    });
    // The event now belongs to the template, so Repeat on it uses this one.
    if (body.fromEventId) await prisma.event.update({ where: { id: body.fromEventId }, data: { templateId: t.id } });
    res
      .status(201)
      .json({ success: true, data: templateDto(t, host.guildId, t.uses) } satisfies ApiResponse<EventTemplateDto>);
  } catch (err) {
    if (err instanceof ValidationError) {
      fail(res, 400, err.message);
      return;
    }
    console.error('[event-templates] create:', err);
    fail(res, 500, 'Could not save the template');
  }
});

// Repeat: the template behind an event, so the new event counts as a use of
// it. An event made from a curated template repeats that template (never a
// copy of it); otherwise Repeat's own template, keyed on the source event, is
// made or refreshed from the event.
eventTemplatesRouter.post('/:guildId/event-templates/from-event', requireAuth, async (req, res) => {
  const host = await hostFor(req, res);
  if (!host) return;
  const { eventId } = (req.body ?? {}) as { eventId?: string };
  if (!eventId) {
    fail(res, 400, 'eventId is required');
    return;
  }
  const event = await prisma.event.findFirst({ where: { id: eventId, guildId: host.guildId } });
  if (!event) {
    fail(res, 404, 'Event not found');
    return;
  }

  if (event.templateId) {
    const linked = await findTemplate(host.id, event.templateId);
    if (linked?.curated) {
      res.json({
        success: true,
        data: templateDto(linked, host.guildId, linked.uses),
      } satisfies ApiResponse<EventTemplateDto>);
      return;
    }
  }

  const me = await userIds(req);
  const fields = {
    name: event.name,
    description: event.description,
    musterPoint: event.musterPoint,
    roles: event.roles,
    vcNames: event.vcNames,
    briefingChannel: event.briefingChannel,
    imageUrl: event.imageUrl,
  };
  const existing = await prisma.eventTemplate.findUnique({ where: { sourceEventId: eventId } });
  const t = existing?.curated
    ? await prisma.eventTemplate.findUniqueOrThrow({
        where: { id: existing.id },
        include: { uses: { select: { usedAt: true } } },
      })
    : await prisma.eventTemplate.upsert({
        where: { sourceEventId: eventId },
        create: { ...fields, guildId: host.id, sourceEventId: eventId, createdById: me.id },
        update: { ...fields, isActive: true },
        include: { uses: { select: { usedAt: true } } },
      });
  res.json({ success: true, data: templateDto(t, host.guildId, t.uses) } satisfies ApiResponse<EventTemplateDto>);
});

// ── One template ─────────────────────────────────────────────────────────────

eventTemplatesRouter.get('/:guildId/event-templates/:id', requireAuth, async (req, res) => {
  const host = await hostFor(req, res);
  if (!host) return;
  const t = await findTemplate(host.id, params(req).id);
  if (!t) {
    fail(res, 404, 'Template not found');
    return;
  }
  res.json({ success: true, data: templateDto(t, host.guildId, t.uses) } satisfies ApiResponse<EventTemplateDto>);
});

eventTemplatesRouter.put('/:guildId/event-templates/:id', requireAuth, async (req, res) => {
  const host = await hostFor(req, res);
  if (!host) return;
  const t = await findTemplate(host.id, params(req).id);
  if (!t) {
    fail(res, 404, 'Template not found');
    return;
  }
  try {
    const data = cleanBody((req.body ?? {}) as UpsertEventTemplateBody);
    // Editing a template makes it curated: Repeat stops overwriting it.
    const updated = await prisma.eventTemplate.update({
      where: { id: t.id },
      data: { ...data, curated: true },
      include: { uses: { select: { usedAt: true } } },
    });
    res.json({
      success: true,
      data: templateDto(updated, host.guildId, updated.uses),
    } satisfies ApiResponse<EventTemplateDto>);
  } catch (err) {
    if (err instanceof ValidationError) {
      fail(res, 400, err.message);
      return;
    }
    console.error('[event-templates] update:', err);
    fail(res, 500, 'Could not save the template');
  }
});

// Soft delete: events keep their templateId, usage history stays.
eventTemplatesRouter.delete('/:guildId/event-templates/:id', requireAuth, async (req, res) => {
  const host = await hostFor(req, res);
  if (!host) return;
  const t = await findTemplate(host.id, params(req).id);
  if (!t) {
    fail(res, 404, 'Template not found');
    return;
  }
  await prisma.eventTemplate.update({ where: { id: t.id }, data: { isActive: false } });
  res.json({ success: true } satisfies ApiResponse);
});

// ── A template's briefing ────────────────────────────────────────────────────

async function hostLogo(guildId: string): Promise<BriefingLogo[]> {
  const g = await prisma.guild.findUnique({
    where: { guildId },
    select: { guildId: true, name: true, settings: { select: { logoUrl: true, allianceTag: true } } },
  });
  return g
    ? [
        {
          guildId: g.guildId,
          name: g.name,
          tag: g.settings?.allianceTag ? serverLabel(g.settings.allianceTag, g.name) : null,
          logoUrl: g.settings?.logoUrl ?? null,
        },
      ]
    : [];
}

function briefingDto(
  t: NonNullable<Awaited<ReturnType<typeof findTemplate>>>,
  guildId: string,
  logos: BriefingLogo[],
): EventTemplateBriefingDto {
  return {
    template: templateDto(t, guildId, t.uses),
    content: t.briefing ? parseBriefing(t.briefing) : null,
    updatedAt: t.briefingUpdatedAt ? t.briefingUpdatedAt.toISOString() : null,
    logos,
  };
}

eventTemplatesRouter.get('/:guildId/event-templates/:id/briefing', requireAuth, async (req, res) => {
  const host = await hostFor(req, res);
  if (!host) return;
  const t = await findTemplate(host.id, params(req).id);
  if (!t) {
    fail(res, 404, 'Template not found');
    return;
  }
  res.json({
    success: true,
    data: briefingDto(t, host.guildId, await hostLogo(host.guildId)),
  } satisfies ApiResponse<EventTemplateBriefingDto>);
});

// Saves a briefing to the template. With fromEventId (the event briefing
// editor's "Save to template"), roster groups are re-linked from the event's
// roles to the template's.
eventTemplatesRouter.put('/:guildId/event-templates/:id/briefing', requireAuth, async (req, res) => {
  const host = await hostFor(req, res);
  if (!host) return;
  const t = await findTemplate(host.id, params(req).id);
  if (!t) {
    fail(res, 404, 'Template not found');
    return;
  }
  const { content: raw, fromEventId } = (req.body ?? {}) as { content?: unknown; fromEventId?: string };
  if (!raw || typeof raw !== 'object') {
    fail(res, 400, 'content is required');
    return;
  }
  let content = sanitizeBriefing(raw);
  if (fromEventId) {
    const ev = await prisma.event.findFirst({
      where: { id: fromEventId, guildId: host.guildId },
      select: { roles: true },
    });
    if (!ev) {
      fail(res, 404, 'Event not found');
      return;
    }
    content = sanitizeBriefing(remapBriefingRoles(content, parseRoles(ev.roles), parseRoles(t.roles)));
  }
  const updated = await prisma.eventTemplate.update({
    where: { id: t.id },
    data: { briefing: JSON.stringify(content), briefingUpdatedAt: new Date(), curated: true },
    include: { uses: { select: { usedAt: true } } },
  });
  res.json({
    success: true,
    data: briefingDto(updated, host.guildId, await hostLogo(host.guildId)),
  } satisfies ApiResponse<EventTemplateBriefingDto>);
});

eventTemplatesRouter.delete('/:guildId/event-templates/:id/briefing', requireAuth, async (req, res) => {
  const host = await hostFor(req, res);
  if (!host) return;
  const t = await findTemplate(host.id, params(req).id);
  if (!t) {
    fail(res, 404, 'Template not found');
    return;
  }
  await prisma.eventTemplate.update({ where: { id: t.id }, data: { briefing: null, briefingUpdatedAt: null } });
  res.json({ success: true } satisfies ApiResponse);
});
