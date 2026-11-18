'use strict';
// Presentation-only gate. Public static files remain publicly accessible.
const DemoAccess = (() => {
  const key='btdt.demo-session.v1';
  const validCredentials=(username,password)=>typeof username==='string' && username.trim()==='admin' && password==='admin';
  function createSession(storage) {
    let signedIn=false;
    try { signedIn=storage?.getItem(key)==='signed-in'; } catch (_) { /* Use memory if storage is unavailable. */ }
    return {
      isSignedIn:()=>signedIn,
      signIn(username,password) {
        if (!validCredentials(username,password)) return false;
        signedIn=true;
        try { storage?.setItem(key,'signed-in'); } catch (_) { /* The current page can still run the demo. */ }
        return true;
      },
      signOut() {
        signedIn=false;
        try { storage?.removeItem(key); } catch (_) { /* No credentials are stored. */ }
      }
    };
  }
  let storage=null;
  if (typeof window!=='undefined') { try { storage=window.sessionStorage; } catch (_) { /* Optional. */ } }
  const session=createSession(storage);
  if (typeof document!=='undefined') {
    const $=id=>document.getElementById(id);
    const screen=$('login-screen'), dashboard=$('dashboard-session');
    const username=$('login-username'), password=$('login-password'), error=$('login-error');
    function showSession() {
      const signedIn=session.isSignedIn();
      screen.hidden=signedIn;dashboard.hidden=!signedIn;
      if (!signedIn) document.title='Sign in | Bin There, Detected That';
    }
    function clearError() {
      error.hidden=true;
      username.removeAttribute('aria-invalid');password.removeAttribute('aria-invalid');
    }
    $('login-form').addEventListener('submit',event=>{
      event.preventDefault();clearError();
      if (!session.signIn(username.value,password.value)) {
        error.hidden=false;
        username.setAttribute('aria-invalid','true');password.setAttribute('aria-invalid','true');
        password.value='';password.focus();return;
      }
      username.value='';password.value='';showSession();
      window.dispatchEvent(new Event('demo-signed-in'));
      $('view-title').tabIndex=-1;$('view-title').focus({preventScroll:true});
      window.scrollTo(0,0);
    });
    username.addEventListener('input',clearError);password.addEventListener('input',clearError);
    $('demo-sign-out').addEventListener('click',()=>{
      session.signOut();$('assistant-dialog').close();showSession();
      // Reload drops loaded records, assistant history, and all transient dashboard state.
      window.location.reload();
    });
    $('login-submit').disabled=false;
    showSession();
  }
  return {...session,validCredentials,createSession};
})();
if (typeof module!=='undefined') module.exports=DemoAccess;
