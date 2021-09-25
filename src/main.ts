import { Client } from '@notionhq/client';
import { RelationProperty, RichTextPropertyValue, RollupPropertyValue, TitlePropertyValue } from '@notionhq/client/build/src/api-types';
require('dotenv').config();

const notion = new Client({
    auth: process.env.NOTION_KEY,
});

type RelationPropertyValue = {
    id: string;
    type: 'relation';
    relation: {
        id: string;
    }[];
}
// タイトルから抽出する情報
type TitleInfo = {
    name: string;
    interviewer: string[];
}
type Info = TitleInfo & {
    title: string;
}

type MemberInfo = {
    id: string;
    name: string;
}

/**
 * タイトルから、情報取得
 */
function extractInfo(title: string): TitleInfo {
    const reg = /インタビュー】(?<name>.*)さんインタビュー（インタビューアー：(?<interviewer>.*)さん/;
    const g = title.match(reg).groups;

    // インタビュアーが複数の場合は分割
    const interviewer = g.interviewer.split(/・|、/).map((name) => {
        if (name.endsWith('さん')) {
            return name.substring(0, name.length - 2).replace(/( |　)/g, '');
        } else {
            return name.replace(/( |　)/g, '');
        }
    });
    return {
        name: g.name.replace(/( |　)/g, ''),
        interviewer,
    };
}
type UpdateInfo = {
    pageId: string; // 更新対象のページID
    interviewee: {
        id?: string | undefined;  // インタビュイーページID。undefinedの場合、ページを作成する。
        name: string;
    } | undefined;
    interviewer: {
        id?: string | undefined;    // インタビュアーページID。undefinedの場合、ページを作成する。
        name: string;
    }[];
}
/**
 * ページ更新情報取得
 * @param memberMap Fellow一覧ページ情報（名前とページIDのマップ）
 * @returns 更新する必要のある情報
 */
async function getPageInfo(memberMap: {[name: string]: MemberInfo}): Promise<UpdateInfo[]> {
    const myPage = await notion.databases.query({
        database_id: process.env.INTERVIEW_DATABASE_ID,
    });
    const result = [] as UpdateInfo[];
    myPage.results.forEach((page) => {
        const titleCol = page.properties['タイトル'] as RichTextPropertyValue;
        const title = titleCol.rich_text[0].plain_text;

        // 情報抽出
        const titleInfo = extractInfo(title);

        // リンク先ページ取得
        const info = {
            pageId: page.id,
            interviewer: [],
        } as UpdateInfo;

        // インタビュイー
        const interviewee = titleInfo.name;
        if (memberMap[interviewee] !== undefined) {
            const intervieweeCol = (page.properties['インタビュイー'] as unknown) as RelationPropertyValue;
            if (intervieweeCol.relation.indexOf({id: memberMap[interviewee].id}) === -1) {
                // インタビュイーが設定されていない場合
                info.interviewee = {
                    id: memberMap[interviewee].id,
                    name: memberMap[interviewee].name,
                }
            }
        } else {
            //  メンバーページ作成
            info.interviewee = {
                name: interviewee,
            }
        }

        // インタビュアー
        titleInfo.interviewer.forEach((name) => {
            const interviewerCol = (page.properties['インタビュアー'] as unknown) as RelationPropertyValue;
            if (memberMap[name] !== undefined) {
                if (interviewerCol.relation.indexOf({id: memberMap[name].id}) === -1) {
                    // インタビュアーが設定されていない場合
                    info.interviewer.push({
                        id: memberMap[name].id,
                        name,
                    });
                }
            } else {
                // メンバーページ作成
                info.interviewer.push({
                    name,
                });
            }
        })

        if (info.interviewee !== undefined || info.interviewer.length > 0) {
            result.push(info);
        }
    })
    return result;

}

// メンバー情報取得
async function loadFellowList(): Promise<{[name: string]: MemberInfo}> {
    const myPage = await notion.databases.query({
        database_id: process.env.MEMBER_DATABASE_ID,
    });
    const infoMap = {} as {[name: string]: MemberInfo};
    myPage.results.forEach((page) => {
        const titleCol = page.properties['Name'] as TitlePropertyValue;
        const title = titleCol.title[0].plain_text;
        // 空白除去
        const key = title.replace(/( |　)/g, '');
        infoMap[key] = {
            id: page.id,
            name: title,
        };
    });
    return infoMap;
}

async function updatePage(updateInfo: UpdateInfo[]) {
    Promise.all(updateInfo.map(async(info) => {
        console.log('info', info);
        if (info.interviewee?.id !== undefined) {
            console.log('update');
            return await notion.pages.update({
                page_id: info.pageId,
                properties: {
                    // @ts-ignore
                    'Property': {
                        'rich_text': [{
                            type: 'text',
                            text: {
                                content: 'Test2',
                            },
                        }],
                    },
                    'インタビュイー': {
                        // @ts-ignore
                        'relation': [{
                            id: info.interviewee.id,
                        }],
                    },
                },
                archived: false,
            });
        } else {
            return Promise.resolve();
        }
    }));

}

async function main() {
    const memberMap = await loadFellowList();
    // console.log(memberMap);
    const updateInfo = await getPageInfo(memberMap);
    // console.log(updateInfo);
    await updatePage(updateInfo);
}
main();
