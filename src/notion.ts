import { Client } from '@notionhq/client';
import { config } from './config';
import { JobRecord } from './db';

const notion = new Client({ auth: config.notionApiToken });

export async function saveToNotion(job: JobRecord) {
  if (!config.notionApiToken || !config.notionDatabaseId) {
    return;
  }

  try {
    await notion.pages.create({
      parent: { database_id: config.notionDatabaseId },
      properties: {
        '職缺名稱': {
          title: [
            {
              text: {
                content: job.title,
              },
            },
          ],
        },
        '公司名稱': {
          rich_text: [
            {
              text: {
                content: job.company,
              },
            },
          ],
        },
        '職缺地址': {
          rich_text: [
            {
              text: {
                content: job.location || '未知',
              },
            },
          ],
        },
        '職缺連結': {
          url: job.url,
        },
        '狀態': {
          select: {
            name: job.status === 'applied' ? '已投遞' : '跳過/失敗',
          },
        },
        'AI評分': {
          number: job.score,
        },
        'AI短評': {
          rich_text: [
            {
              text: {
                content: job.reason,
              },
            },
          ],
        },
        '投遞時間': {
          date: {
            start: new Date().toISOString(),
          },
        },
      },
    });
    console.log(`[Notion] 已同步紀錄: ${job.title}`);
  } catch (error) {
    console.error('[Notion] 同步失敗:', error);
  }
}
