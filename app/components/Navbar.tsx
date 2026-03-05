'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from './AuthProvider';
import {
  NavigationMenu,
  NavigationMenuList,
  NavigationMenuItem,
  NavigationMenuLink,
  navigationMenuTriggerStyle,
} from './ui/navigation-menu';
import { cn } from '@/lib/utils';

const navigation = [
  { name: 'Dashboard', href: '/dashboard' },
  { name: 'Invoices', href: '/invoices' },
  { name: 'Findings', href: '/findings' },
  { name: 'Reports', href: '/reports' },
  { name: 'Mailboxes', href: '/mailboxes' },
  { name: 'Settings', href: '/settings' },
];

export default function Navbar() {
  const pathname = usePathname();
  const { user, signOut } = useAuth();
  const [showLogout, setShowLogout] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  const handleSignOut = async () => {
    setSignOutError(null);
    try {
      await signOut();
    } catch {
      setSignOutError('Unable to sign out. Please try again.');
    }
  };

  return (
    <nav className="bg-brand-surface border-b border-brand-border">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="relative flex justify-between items-center h-16">
          <div className="flex-shrink-0 flex items-center">
            <Link href="/dashboard" className="block" aria-label="Sifter home">
              <Image
                src="/Sifter_Dark_Logo.png"
                alt="Sifter"
                width={80}
                height={16}
                className="h-8 w-auto"
              />
            </Link>
          </div>
          <div className="absolute left-1/2 -translate-x-1/2 hidden sm:flex">
            <NavigationMenu>
              <NavigationMenuList className="space-x-1">
                {navigation.map((item) => {
                  const isActive =
                    pathname === item.href ||
                    pathname.startsWith(item.href + '/');
                  return (
                    <NavigationMenuItem key={item.name}>
                      <NavigationMenuLink asChild>
                        <Link
                          href={item.href}
                          className={cn(
                            navigationMenuTriggerStyle(),
                            isActive && 'text-brand-primary bg-brand-surface-muted'
                          )}
                        >
                          {item.name}
                        </Link>
                      </NavigationMenuLink>
                    </NavigationMenuItem>
                  );
                })}
              </NavigationMenuList>
            </NavigationMenu>
          </div>
          <div className="flex items-center space-x-4 flex-shrink-0">
            {user && (
              <>
                <div className="relative">
                  <button
                    onClick={() => setShowLogout(!showLogout)}
                    className="flex items-center text-sm rounded-md px-4 py-2 text-brand-muted hover:text-brand-primary hover:bg-brand-surface-muted focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-brand-border-focus"
                  >
                    {user.email || 'User'}
                  </button>
                  {showLogout && (
                    <div className="absolute right-0 mt-2 w-48 rounded-md shadow-lg bg-brand-surface border border-brand-border z-10">
                      <div className="py-1">
                        {signOutError && (
                          <p className="px-4 py-2 text-xs text-red-600">
                            {signOutError}
                          </p>
                        )}
                        <button
                          onClick={handleSignOut}
                          className="block w-full text-left px-4 py-2 text-sm text-brand-primary hover:bg-brand-surface-muted"
                        >
                          Sign out
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
}

