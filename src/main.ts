import { Client } from '@notionhq/client';
import { RichTextPropertyValue } from '@notionhq/client/build/src/api-types';
require('dotenv').config();

const notion = new Client({
    auth: process.env.NOTION_KEY,
});

// タイトルから抽出する情報
type TitleInfo = {
    name: string;
    interviewer: string[];
}
type Info = TitleInfo & {
    title: string;
}

function extractInfo(title: string): TitleInfo {
    const reg = /インタビュー】(?<name>.*)さんインタビュー（インタビューアー：(?<interviewer>.*)さん/;
    const g = title.match(reg).groups;

    // インタビュアーが複数の場合は分割
    const interviewer = g.interviewer.split(/・|、/).map((name) => {
        if (name.endsWith('さん')) {
            return name.substring(0, name.length - 2);
        } else {
            return name;
        }
    });
    return {
        name: g.name,
        interviewer,
    };
}
// ページ情報取得
async function getPageInfo(): Promise<any> {
    const myPage = await notion.databases.query({
        database_id: process.env.NOTION_DATABASE_ID,
    });
    myPage.results.forEach((page) => {
        const titleCol = page.properties['タイトル'] as RichTextPropertyValue;
        const title = titleCol.rich_text[0].plain_text;

        // 情報抽出
        const titleInfo = extractInfo(title);
        console.log(titleInfo);
    })
}
getPageInfo();
