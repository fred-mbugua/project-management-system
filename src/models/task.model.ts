// ══════════════════════════════════════════════════════════════════════
// Task Model - Raw PostgreSQL Queries
// ══════════════════════════════════════════════════════════════════════

import { PoolClient } from 'pg';
import { query } from '../config/database';
import { Task, TaskStatus, TaskPriority } from './types';

export interface CreateTaskInput {
  id?: string;
  tenantId: string;
  projectId: string;
  assignedToId?: string | null;
  title: string;
  description?: string | null;
  status?: TaskStatus;
  priority?: TaskPriority;
  estimatedHours?: number | null;
  actualHours?: number | null;
  dueDate?: Date | null;
  completedAt?: Date | null;
}

export class TaskModel {
  private static mapRow(row: any): Task {
    return {
      id: row.id,
      tenantId: row.tenant_id,
      projectId: row.project_id,
      assignedToId: row.assigned_to_id,
      title: row.title,
      description: row.description,
      status: row.status,
      priority: row.priority,
      estimatedHours: row.estimated_hours != null ? parseFloat(row.estimated_hours) : null,
      actualHours: row.actual_hours != null ? parseFloat(row.actual_hours) : null,
      dueDate: row.due_date ? new Date(row.due_date) : null,
      completedAt: row.completed_at ? new Date(row.completed_at) : null,
      createdAt: new Date(row.created_at),
      updatedAt: new Date(row.updated_at),
    };
  }

  static async findById(id: string, client?: PoolClient): Promise<Task | null> {
    const sql = `SELECT * FROM tasks WHERE id = $1 LIMIT 1`;
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, [id]);
    return res.rows[0] ? this.mapRow(res.rows[0]) : null;
  }

  static async findByProject(projectId: string, client?: PoolClient): Promise<Task[]> {
    const sql = `SELECT * FROM tasks WHERE project_id = $1 ORDER BY created_at ASC`;
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, [projectId]);
    return res.rows.map(this.mapRow);
  }

  static async create(data: CreateTaskInput, client?: PoolClient): Promise<Task> {
    const sql = `
      INSERT INTO tasks (
        id, tenant_id, project_id, assigned_to_id, title,
        description, status, priority, estimated_hours,
        actual_hours, due_date, completed_at, updated_at
      ) VALUES (
        COALESCE($1, gen_random_uuid()::text),
        $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW()
      )
      RETURNING *
    `;
    const values = [
      data.id || null,
      data.tenantId,
      data.projectId,
      data.assignedToId || null,
      data.title.trim(),
      data.description || null,
      data.status || TaskStatus.TODO,
      data.priority || TaskPriority.MEDIUM,
      data.estimatedHours || null,
      data.actualHours || null,
      data.dueDate || null,
      data.completedAt || null,
    ];
    const runner = client ? client.query.bind(client) : query;
    const res = await runner(sql, values);
    return this.mapRow(res.rows[0]);
  }

  static async createMany(tasks: CreateTaskInput[], client?: PoolClient): Promise<Task[]> {
    const results: Task[] = [];
    for (const t of tasks) {
      const created = await this.create(t, client);
      results.push(created);
    }
    return results;
  }
}
