import { NextRequest, NextResponse } from 'next/server';
import { sql } from '@/lib/db';
import crypto from 'crypto';

export const preferredRegion = 'sin1';

// GET: Fetch replace rules, optionally filtered by scope
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const scope = searchParams.get('scope');
    const scopeValue = searchParams.get('scope_value');

    let rules;
    if (scope) {
      if (scopeValue) {
        rules = await sql`
          SELECT * FROM replace_rules
          WHERE scope = ${scope} AND scope_value = ${scopeValue}
          ORDER BY sort_order, created_at
        `;
      } else {
        rules = await sql`
          SELECT * FROM replace_rules
          WHERE scope = ${scope}
          ORDER BY sort_order, created_at
        `;
      }
    } else {
      rules = await sql`
        SELECT * FROM replace_rules
        ORDER BY scope, sort_order, created_at
      `;
    }

    return NextResponse.json(rules);
  } catch (error: unknown) {
    console.error('Error fetching replace rules:', error);
    const errorMsg = error instanceof Error ? error.message : 'Failed to fetch rules';
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

// POST: Create or update a replace rule
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      id,
      scope = 'global',
      scope_value,
      find_text,
      replace_with,
      is_regex = false,
      is_enabled = true,
      sort_order = 0
    } = body;

    if (!find_text || replace_with === undefined) {
      return NextResponse.json(
        { error: 'Missing find_text or replace_with' },
        { status: 400 }
      );
    }

    if (!['global', 'book', 'chapter'].includes(scope)) {
      return NextResponse.json(
        { error: 'Invalid scope. Must be global, book, or chapter' },
        { status: 400 }
      );
    }

    // Validate regex if is_regex is true
    if (is_regex) {
      try {
        new RegExp(find_text);
      } catch {
        return NextResponse.json(
          { error: 'Invalid regex pattern' },
          { status: 400 }
        );
      }
    }

    const ruleId = id || crypto.randomBytes(8).toString('hex');

    if (id) {
      // Update existing rule
      await sql`
        UPDATE replace_rules
        SET scope = ${scope},
            scope_value = ${scope_value || null},
            find_text = ${find_text},
            replace_with = ${replace_with},
            is_regex = ${is_regex},
            is_enabled = ${is_enabled},
            sort_order = ${sort_order}
        WHERE id = ${id}
      `;
    } else {
      // Insert new rule
      await sql`
        INSERT INTO replace_rules (id, scope, scope_value, find_text, replace_with, is_regex, is_enabled, sort_order)
        VALUES (${ruleId}, ${scope}, ${scope_value || null}, ${find_text}, ${replace_with}, ${is_regex}, ${is_enabled}, ${sort_order})
      `;
    }

    return NextResponse.json({ success: true, id: ruleId });
  } catch (error: unknown) {
    console.error('Error saving replace rule:', error);
    const errorMsg = error instanceof Error ? error.message : 'Failed to save rule';
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}

// DELETE: Delete a replace rule
export async function DELETE(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { error: 'Missing rule id' },
        { status: 400 }
      );
    }

    await sql`DELETE FROM replace_rules WHERE id = ${id}`;

    return NextResponse.json({ success: true });
  } catch (error: unknown) {
    console.error('Error deleting replace rule:', error);
    const errorMsg = error instanceof Error ? error.message : 'Failed to delete rule';
    return NextResponse.json({ error: errorMsg }, { status: 500 });
  }
}
