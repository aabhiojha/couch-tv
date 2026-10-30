//
// MainLoop.cs
//
// Authors:
//   Alan McGovern alan.mcgovern@gmail.com
//
// Copyright (C) 2008 Alan McGovern
//
// Permission is hereby granted, free of charge, to any person obtaining
// a copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to
// permit persons to whom the Software is furnished to do so, subject to
// the following conditions:
// 
// The above copyright notice and this permission notice shall be
// included in all copies or substantial portions of the Software.
// 
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
// EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
// NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
// LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
// OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
// WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
//

#nullable enable

using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.CompilerServices;
using System.Threading;

namespace MonoTorrent.Client
{
    internal class MainLoop : SynchronizationContext, INotifyCompletion
    {
        static readonly ICache<CacheableManualResetEventSlim> cache = new SynchronizedCache<CacheableManualResetEventSlim>(() => new CacheableManualResetEventSlim());

        private struct QueuedTask
        {
            public Action Action;

            public SendOrPostCallback SendOrPostCallback;
            public object? State;

            public ManualResetEventSlim WaitHandle;
        }

        private class CacheableManualResetEventSlim : ManualResetEventSlim, ICacheable
        {
            public void Initialise()
            {
                Reset();
            }
        }

        Queue<QueuedTask> actions = new Queue<QueuedTask>();
        readonly object actionsLock = new object();
        readonly Thread thread;

        public MainLoop(string name)
        {
            thread = new Thread(Loop)
            {
                Name = name,
                IsBackground = true
            };
            thread.Start();
            MonoTorrent.LoopMonitor.Register(this, name);
        }

        // Couch TV: what the loop is running right now, read by LoopMonitor from other threads.
        internal long BusySince; // Stopwatch timestamp, 0 when idle
        internal Delegate? Current;
        internal long Executed;
        internal int ThreadId;
        internal int QueueLength { get { lock (actionsLock) return actions.Count; } }

        void Loop()
        {
            var currentQueue = new Queue<QueuedTask>();

            SetSynchronizationContext(this);
            ThreadId = MonoTorrent.LoopMonitor.NativeThreadId();
#if ALLOW_EXECUTION_CONTEXT_SUPPRESSION
            using (ExecutionContext.SuppressFlow ())
#endif
            while (true)
            {

                lock (actionsLock)
                {
                    if (actions.Count == 0)
                        Monitor.Wait(actionsLock);

                    var swap = actions;
                    actions = currentQueue;
                    currentQueue = swap;
                }

                while (currentQueue.Count > 0)
                {
                    var task = currentQueue.Dequeue();
                    Current = (Delegate?)task.Action ?? task.SendOrPostCallback;
                    BusySince = Stopwatch.GetTimestamp();
                    try
                    {
                        task.Action?.Invoke();
                        task.SendOrPostCallback?.Invoke(task.State);
                    }
                    catch (Exception ex)
                    {
                        MonoTorrent.LoopMonitor.OnException(ex);
                    }
                    finally
                    {
                        BusySince = 0;
                        Executed++;
                        task.WaitHandle?.Set();
                    }
                }
            }
        }

        public void QueueWait(Action action)
        {
            Send(t => action(), null);
        }

        public object QueueWait(Func<object> func)
        {
            object? result = null;
            Send(t => result = func(), null);
            return result!;
        }

        public void QueueTimeout(TimeSpan span, Func<bool> task)
        {
            if (span.TotalMilliseconds < 1)
                span = TimeSpan.FromMilliseconds(1);
            bool disposed = false;
            Timer timer = null!;

            SendOrPostCallback callback = state => {
                if (!disposed && !task ()) {
                    disposed = true;
                    timer.Dispose ();
                }
            };

            timer = new Timer(state =>
            {
                Post(callback, null);
            }, null, span, span);
        }

        void Queue(QueuedTask task)
        {
            lock (actionsLock)
            {
                actions.Enqueue(task);
                if (actions.Count == 1)
                    Monitor.Pulse(actionsLock);
            }
        }

        [EditorBrowsable(EditorBrowsableState.Never)]
        public override void Post(SendOrPostCallback d, object? state)
        {
            Queue(new QueuedTask { SendOrPostCallback = d, State = state });
        }

        [EditorBrowsable(EditorBrowsableState.Never)]
        public override void Send(SendOrPostCallback d, object? state)
        {
            if (thread == Thread.CurrentThread)
            {
                d(state);
            }
            else
            {
                CacheableManualResetEventSlim waiter = cache.Dequeue();
                Queue(new QueuedTask { SendOrPostCallback = d, State = state, WaitHandle = waiter });
                waiter.Wait();
                cache.Enqueue(waiter);
            }
        }

        #region If you await the MainLoop you'll swap to it's thread!
        [EditorBrowsable(EditorBrowsableState.Never)]
        public MainLoop GetAwaiter()
        {
            return this;
        }

        [EditorBrowsable(EditorBrowsableState.Never)]
        public bool IsCompleted => thread == Thread.CurrentThread;

        [EditorBrowsable(EditorBrowsableState.Never)]
        public void GetResult()
        {

        }

        [EditorBrowsable(EditorBrowsableState.Never)]
        public void OnCompleted(Action continuation)
        {
            Queue(new QueuedTask { Action = continuation });
        }

        /// <summary>
        /// When <see cref="ThreadSwitcher"/> is awaited the continuation will be executed
        /// on the threadpool. If you are already on a threadpool thread the continuation
        /// will execute synchronously.
        /// </summary>
        /// <returns></returns>
        public static EnsureThreadPool SwitchToThreadpool()
        {
            return new EnsureThreadPool();
        }

        /// <summary>
        /// When <see cref="ThreadSwitcher"/> is awaited the continuation will always be queued on
        /// the ThreadPool for execution. It will never execute synchronously.
        /// </summary>
        /// <returns></returns>
        public static ThreadSwitcher SwitchThread()
        {
            return new ThreadSwitcher();
        }

        [Conditional("DEBUG")]
        internal void CheckThread()
        {
            if (Thread.CurrentThread != thread)
                throw new InvalidOperationException($"Missing context switch to the {thread.Name} MainLoop.");
        }

        #endregion
    }
}
