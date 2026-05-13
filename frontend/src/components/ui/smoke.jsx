import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ChartContainer } from '@/components/ui/chart'
import { Dialog, DialogContent, DialogTrigger } from '@/components/ui/dialog'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const chartConfig = {
  opens: {
    label: 'Open count',
    color: 'var(--color-chart-1)',
  },
}

export function UiSmoke() {
  return (
    <div className="hidden">
      <Button />
      <Badge />
      <Input />
      <Textarea />
      <Label htmlFor="ui-smoke-input">Smoke</Label>
      <Separator />
      <Skeleton className="h-4 w-20" />
      <Avatar>
        <AvatarFallback>UI</AvatarFallback>
      </Avatar>
      <Card>
        <CardHeader>
          <CardTitle>Smoke</CardTitle>
        </CardHeader>
        <CardContent />
      </Card>
      <Tabs defaultValue="tab-1">
        <TabsList>
          <TabsTrigger value="tab-1">One</TabsTrigger>
        </TabsList>
        <TabsContent value="tab-1">Tab</TabsContent>
      </Tabs>
      <Dialog>
        <DialogTrigger asChild>
          <Button type="button">Dialog</Button>
        </DialogTrigger>
        <DialogContent />
      </Dialog>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button type="button">Menu</Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          <DropdownMenuItem>Item</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <Sheet>
        <SheetTrigger asChild>
          <Button type="button">Sheet</Button>
        </SheetTrigger>
        <SheetContent />
      </Sheet>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button type="button">Tooltip</Button>
        </TooltipTrigger>
        <TooltipContent>Tip</TooltipContent>
      </Tooltip>
      <ScrollArea className="h-8 w-24" />
      <ChartContainer config={chartConfig}>
        <div />
      </ChartContainer>
    </div>
  )
}
