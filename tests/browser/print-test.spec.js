import {test,expect} from '@playwright/test';
import {cube,stl} from '../fixtures.js';
const box=(x,y,z,w,d,h)=>Float32Array.from(cube(),(value,i)=>value*([w,d,h][i%3]/20)+[x,y,z][i%3]);

test('STL test preview highlights detached text, animates a fall and gives short advice',async({page})=>{
 const errors=[];page.on('pageerror',error=>errors.push(error.message));page.on('console',message=>{if(message.type()==='error'&&/THREE|shader|WebGL/.test(message.text()))errors.push(message.text());});
 await page.goto('http://127.0.0.1:4174/');
 await page.getByLabel('Upload a 3D printing file').setInputFiles({name:'floating-text.stl',mimeType:'application/octet-stream',buffer:stl(new Float32Array([...cube(),...box(5,5,22,8,3,3)]))});
 await expect(page.getByText('1 possibly floating part')).toBeVisible();await expect(page.getByRole('button',{name:'Highlight separate parts'})).toHaveAttribute('aria-pressed','true');await expect(page.getByRole('button',{name:'Highlight floating parts'})).toHaveAttribute('aria-pressed','true');
 await page.getByRole('button',{name:'Test print',exact:true}).click();await expect(page.locator('.viewer')).toHaveAttribute('data-print-test-phase','printing');await expect(page.getByRole('button',{name:'Confirm my model'})).toBeDisabled();
 await expect(page.locator('.viewer')).toHaveAttribute('data-print-test-phase','falling',{timeout:12000});await expect(page.locator('.print-animation-label')).toContainText('Floating parts are falling');await page.screenshot({path:'test-results/test-print-floating.png',fullPage:true});
 await expect(page.getByText('Your print may fail.',{exact:true})).toBeVisible({timeout:10000});const advice=page.locator('.print-test-result li');expect(await advice.count()).toBeLessThanOrEqual(3);await expect(page.locator('.print-test-result')).toContainText('Move floating parts');await expect(page.locator('.print-test-result')).toContainText('Ask your teacher');
 await page.getByRole('button',{name:'Test print',exact:true}).click();await page.getByRole('button',{name:'Stop preview'}).click();await expect(page.locator('.viewer')).toHaveAttribute('data-print-test-phase','idle');await expect(page.getByText('Your print may fail.',{exact:true})).not.toBeVisible();expect(errors).toEqual([]);
});

test('local thin STL walls are highlighted, update with scale and keep one colour per part',async({page})=>{
 await page.goto('http://127.0.0.1:4174/');
 await page.getByLabel('Upload a 3D printing file').setInputFiles({name:'thin-fin.stl',mimeType:'application/octet-stream',buffer:stl(new Float32Array([...cube(),...box(0,0,20,0.4,10,10)]))});
 await expect(page.getByText('Some areas may be too thin')).toBeVisible();await expect(page.getByRole('button',{name:'Highlight thin areas'})).toHaveAttribute('aria-pressed','true');await page.screenshot({path:'test-results/test-print-thin-wall.png',fullPage:true});
 const colours=page.getByRole('radiogroup',{name:'Available print colours'});await colours.getByRole('radio',{name:'Blue',exact:true}).check();await colours.getByRole('radio',{name:'Red',exact:true}).check();await expect(colours.getByRole('radio',{checked:true})).toHaveCount(1);await expect(colours.getByRole('radio',{name:'Blue',exact:true})).not.toBeChecked();await expect(colours.getByRole('radio',{name:'Red',exact:true})).toBeChecked();
 await page.getByRole('spinbutton',{name:'Scale (%)'}).fill('300');await expect(page.getByText('Some areas may be too thin')).not.toBeVisible();await expect(page.getByRole('button',{name:'Highlight thin areas'})).not.toBeVisible();
 await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
