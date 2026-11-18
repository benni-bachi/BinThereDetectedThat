'use strict';
const DashboardChat = (() => {
  const $ = id => document.getElementById(id);
  function node(tag, text, className) {
    const element=document.createElement(tag);
    if (text !== undefined) element.textContent=text;
    if (className) element.className=className;
    return element;
  }
  function mount({getData,getSelection}) {
    const dialog=$('assistant-dialog'), log=$('assistant-messages'), input=$('assistant-question');
    let previous=null, signature='', lastFocus=null, count=0;
    function reset() {
      previous=null;count=0;log.replaceChildren();
      input.value='';$('assistant-count').textContent='0 / 500';
      const welcome=node('article',undefined,'chat-message chat-answer');
      welcome.append(node('strong','How can I help with campus operations?'),
        node('p','Ask about a bin, a location, service schedules, reported fullness, or incidents. Answers use the published dashboard data and your selected filters.'));
      log.append(welcome);
      $('assistant-limit').textContent='';
    }
    function update() {
      const ready=Boolean(getData());
      const selection=getSelection();
      const nextSignature=JSON.stringify(selection);
      if (signature!==nextSignature) {previous=null;signature=nextSignature;}
      const scope=[selection.bin,selection.location,selection.stream].filter(Boolean).join(' · ') || 'All campus';
      $('assistant-scope').textContent=ready ? `${scope} · Reports ${selection.from} to ${selection.to}` : 'Load dashboard data to start.';
      input.disabled=!ready;
      $('assistant-send').disabled=!ready || count>=30;
      dialog.querySelectorAll('[data-question]').forEach(button=>button.disabled=!ready || count>=30);
      if (ready && count>=30) $('assistant-limit').textContent='Start a new conversation to ask more questions.';
    }
    function appendAnswer(answer) {
      const article=node('article',undefined,'chat-message chat-answer');
      article.append(node('span','Dashboard assistant','chat-speaker'),node('h3',answer.title));
      if (answer.scope) article.append(node('p',`${answer.scope} · ${answer.period}`,'chat-answer-scope'));
      answer.paragraphs.forEach(text=>article.append(node('p',text)));
      if (answer.items.length) {
        const list=node('ul');answer.items.forEach(text=>list.append(node('li',text)));article.append(list);
      }
      const source=node('details',undefined,'chat-source');
      source.append(node('summary','Answer source'));
      source.append(node('p',answer.source));
      if (answer.publishedAt) {
        const time=new Date(answer.publishedAt);
        if (Number.isFinite(time.getTime())) source.append(node('p',`Snapshot published ${new Intl.DateTimeFormat('en-US',{dateStyle:'medium',timeStyle:'short',timeZone:'America/Los_Angeles'}).format(time)} Pacific.`));
      }
      article.append(source);
      if (answer.link && ['#overview','#calendar','#missed','#fullness','#explorer','#bins'].includes(answer.link)) {
        const link=node('a','Open related dashboard section','chat-related');link.href=answer.link;
        link.addEventListener('click',()=>{dialog.close();});article.append(link);
      }
      log.append(article);
    }
    function ask(value) {
      const question=value.trim();
      if (!question || !getData() || count>=30) return;
      update();
      const user=node('article',undefined,'chat-message chat-user');
      user.append(node('span','You','chat-speaker'),node('p',question));log.append(user);
      const answer=DashboardAssistant.answer(question,getData(),getSelection(),previous);
      previous=answer.context || null;
      appendAnswer(answer);count++;
      input.value='';$('assistant-count').textContent='0 / 500';update();
      input.focus();log.scrollTop=log.scrollHeight;
    }
    $('assistant-open').addEventListener('click',()=>{
      if (dialog.open) return;
      lastFocus=document.activeElement;update();dialog.showModal();
      if (!input.disabled) input.focus(); else $('assistant-close').focus();
    });
    $('assistant-close').addEventListener('click',()=>dialog.close());
    dialog.addEventListener('close',()=>lastFocus?.focus({preventScroll:true}));
    $('assistant-form').addEventListener('submit',event=>{event.preventDefault();ask(input.value);});
    $('assistant-clear').addEventListener('click',()=>{reset();update();input.focus();});
    input.addEventListener('input',()=>{$('assistant-count').textContent=`${input.value.length} / 500`;});
    dialog.querySelectorAll('[data-question]').forEach(button=>button.addEventListener('click',()=>ask(button.dataset.question)));
    reset();update();
    return {update};
  }
  return {mount};
})();
